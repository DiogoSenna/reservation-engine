import { Test } from '@nestjs/testing'
import { ReservationService } from '../../src/reservation/reservation.service'
import { PrismaService } from '../../src/database/prisma.service'
import { RedisService } from '../../src/redis/redis.service'
import { RedlockService } from '../../src/redis/redlock.service'
import { PaymentService } from '../../src/payment/payment.service'
import { MetricsService } from '../../src/metrics/metrics.service'

describe('ReservationService', () => {
  let service: ReservationService

  const mockLock = { unlock: vi.fn().mockResolvedValue(undefined) }
  const mockPrisma = {
    ticket: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    paymentLog: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  }
  const mockRedis = {
    eval: vi.fn(),
    incr: vi.fn(),
    get: vi.fn(),
    scripts: { decrInventory: 'script' },
  }
  const mockRedlock = { lock: vi.fn().mockResolvedValue(mockLock) }
  const mockPayment = { charge: vi.fn() }
  const mockMetrics = {
    ticketsSoldTotal: { inc: vi.fn() },
    purchaseFailedTotal: { inc: vi.fn() },
    purchaseDurationSeconds: { startTimer: vi.fn().mockReturnValue(() => {}) },
    activeInventory: { set: vi.fn() },
    redisLockAcquisitionsTotal: { inc: vi.fn() },
    redisLockFailuresTotal: { inc: vi.fn() },
  }

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReservationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: RedlockService, useValue: mockRedlock },
        { provide: PaymentService, useValue: mockPayment },
        { provide: MetricsService, useValue: mockMetrics },
      ],
    }).compile()
    service = module.get(ReservationService)
    vi.clearAllMocks()
    mockRedlock.lock.mockResolvedValue(mockLock)
    mockPrisma.ticket.findFirst.mockResolvedValue(null)
  })

  it('returns sold_out when Lua DECR returns 0', async () => {
    mockRedis.eval.mockResolvedValue(0)
    const result = await service.purchase({ userId: 'u1', eventId: 'e1', eventPrice: 50, cardToken: 'tok' })
    expect(result).toEqual({ error: 'sold_out' })
    expect(mockRedlock.lock).not.toHaveBeenCalled()
  })

  it('returns duplicate when user already has a ticket', async () => {
    mockRedis.eval.mockResolvedValue(1)
    mockPrisma.ticket.findFirst.mockResolvedValue({ id: 'existing' })
    const result = await service.purchase({ userId: 'u1', eventId: 'e1', eventPrice: 50, cardToken: 'tok' })
    expect(result).toEqual({ error: 'duplicate' })
    expect(mockRedis.incr).toHaveBeenCalledWith('event:e1:inventory')
  })

  it('compensates inventory when payment fails', async () => {
    mockRedis.eval.mockResolvedValue(1)
    mockPrisma.$transaction
      .mockResolvedValueOnce({ ticket: { id: 'ticket-1' }, paymentLog: { id: 'log-1' } })
      .mockResolvedValueOnce(undefined)
    mockPayment.charge.mockResolvedValue({ success: false, failureReason: 'card_declined', providerRef: null })
    const result = await service.purchase({ userId: 'u1', eventId: 'e1', eventPrice: 50, cardToken: 'tok' })
    expect(result).toEqual({ error: 'payment_failed', reason: 'card_declined' })
    expect(mockRedis.incr).toHaveBeenCalledWith('event:e1:inventory')
  })
})
