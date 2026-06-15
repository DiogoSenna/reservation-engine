import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { RedisService } from '../redis/redis.service'
import type { StripePaymentIntent } from './stripe.types'

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async handlePaymentSucceeded(intent: StripePaymentIntent): Promise<void> {
    const ticketId = intent.metadata?.ticketId
    if (!ticketId) return

    const log = await this.prisma.paymentLog.findFirst({
      where: { ticketId, status: 'initiated' },
    })
    if (!log) return

    await this.prisma.$transaction([
      this.prisma.paymentLog.update({
        where: { id: log.id },
        data: { status: 'success', providerRef: intent.id },
      }),
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'confirmed', expiresAt: null },
      }),
    ])
  }

  async handlePaymentFailed(intent: StripePaymentIntent): Promise<void> {
    const ticketId = intent.metadata?.ticketId
    if (!ticketId) return

    const log = await this.prisma.paymentLog.findFirst({
      where: { ticketId, status: 'initiated' },
    })
    if (!log) return

    const failureReason = intent.last_payment_error?.code ?? 'card_declined'

    await this.prisma.$transaction([
      this.prisma.paymentLog.update({
        where: { id: log.id },
        data: { status: 'failed', failureReason },
      }),
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'cancelled' },
      }),
    ])

    await this.redis.incr(`event:${log.eventId}:inventory`)
  }
}
