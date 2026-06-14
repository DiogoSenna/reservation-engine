import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../database/prisma.service'
import { RedisService } from '../redis/redis.service'
import { RedlockService } from '../redis/redlock.service'
import { PaymentService } from '../payment/payment.service'
import { MetricsService } from '../metrics/metrics.service'
import type { Lock } from 'redlock'
import type { PurchaseOutcome } from '../types'

interface PurchaseOptions {
  userId: string
  eventId: string
  eventPrice: number
  cardToken: string
}

@Injectable()
export class ReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly redlock: RedlockService,
    private readonly payment: PaymentService,
    private readonly metrics: MetricsService,
  ) {}

  async purchase({ userId, eventId, eventPrice, cardToken }: PurchaseOptions): Promise<PurchaseOutcome> {
    const endTimer = this.metrics.purchaseDurationSeconds.startTimer()
    const inventoryKey = `event:${eventId}:inventory`

    // Layer 1: Atomic inventory gate (Lua DECR)
    const claimed = await this.redis.eval(this.redis.scripts.decrInventory, 1, inventoryKey) as number
    if (claimed === 0) {
      this.metrics.purchaseFailedTotal.inc({ reason: 'sold_out' })
      endTimer()
      return { error: 'sold_out' }
    }

    // Layer 2: Redlock critical section
    let lock: Lock
    try {
      lock = await this.redlock.lock(`lock:purchase:${userId}:${eventId}`, 10_000)
      this.metrics.redisLockAcquisitionsTotal.inc()
    } catch {
      this.metrics.redisLockFailuresTotal.inc()
      this.metrics.purchaseFailedTotal.inc({ reason: 'lock_timeout' })
      await this.redis.incr(inventoryKey)
      endTimer()
      return { error: 'lock_timeout' }
    }

    try {
      // Duplicate check inside lock
      const existing = await this.prisma.ticket.findFirst({
        where: { userId, eventId, status: { in: ['pending', 'confirmed'] } },
      })
      if (existing) {
        this.metrics.purchaseFailedTotal.inc({ reason: 'duplicate' })
        await this.redis.incr(inventoryKey)
        return { error: 'duplicate' }
      }

      const idempotencyKey = randomUUID()

      // Layer 3: Postgres ACID — Phase 1 (Hold)
      const { ticket, paymentLog } = await this.prisma.$transaction(async (tx: any) => {
        const ticket = await tx.ticket.create({
          data: {
            userId, eventId,
            status: 'pending',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            idempotencyKey,
          },
        })
        const paymentLog = await tx.paymentLog.create({
          data: { ticketId: ticket.id, userId, eventId, amount: eventPrice, status: 'initiated' },
        })
        return { ticket, paymentLog }
      })

      // External payment call (outside transaction — intentional)
      const paymentResult = await this.payment.charge({ cardToken, amount: eventPrice, idempotencyKey: ticket.id })

      if (paymentResult.success) {
        // Phase 2 (Confirm)
        await this.prisma.$transaction([
          this.prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'confirmed', expiresAt: null } }),
          this.prisma.paymentLog.update({ where: { id: paymentLog.id }, data: { status: 'success', providerRef: paymentResult.providerRef } }),
        ])
        const remaining = await this.redis.get(inventoryKey)
        this.metrics.activeInventory.set({ event_id: eventId }, remaining ? parseInt(remaining) : 0)
        this.metrics.ticketsSoldTotal.inc()
        endTimer()
        return {
          ticket: { id: ticket.id, status: 'confirmed' as const, expiresAt: null },
          paymentLog: { id: paymentLog.id, status: 'success' as const, providerRef: paymentResult.providerRef },
        }
      } else {
        // Saga compensation
        await this.prisma.$transaction([
          this.prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'cancelled' } }),
          this.prisma.paymentLog.update({ where: { id: paymentLog.id }, data: { status: 'failed', failureReason: paymentResult.failureReason } }),
        ])
        await this.redis.incr(inventoryKey)
        this.metrics.purchaseFailedTotal.inc({ reason: 'payment_failed' })
        endTimer()
        return { error: 'payment_failed', reason: paymentResult.failureReason }
      }
    } finally {
      await lock!.unlock().catch(() => {})
    }
  }
}
