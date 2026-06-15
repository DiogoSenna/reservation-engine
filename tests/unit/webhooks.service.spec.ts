import { Test } from '@nestjs/testing'
import { WebhooksService } from '../../src/webhooks/webhooks.service'
import { PrismaService } from '../../src/database/prisma.service'
import { RedisService } from '../../src/redis/redis.service'

describe('WebhooksService', () => {
  let service: WebhooksService

  const mockPrisma = {
    paymentLog: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    ticket: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  }
  const mockRedis = { incr: vi.fn() }

  beforeEach(async () => {
    vi.clearAllMocks()
    const module = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile()
    service = module.get(WebhooksService)
  })

  describe('handlePaymentSucceeded', () => {
    it('does nothing when ticketId is missing from metadata', async () => {
      await service.handlePaymentSucceeded({ id: 'pi_1', metadata: {} } as any)
      expect(mockPrisma.paymentLog.findFirst).not.toHaveBeenCalled()
    })

    it('does nothing when no initiated payment log is found', async () => {
      mockPrisma.paymentLog.findFirst.mockResolvedValue(null)
      await service.handlePaymentSucceeded({ id: 'pi_1', metadata: { ticketId: 'tk_1' } } as any)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('updates paymentLog to success and ticket to confirmed', async () => {
      mockPrisma.paymentLog.findFirst.mockResolvedValue({ id: 'log_1', ticketId: 'tk_1' })
      mockPrisma.$transaction.mockResolvedValue([])
      await service.handlePaymentSucceeded({
        id: 'pi_test_1',
        metadata: { ticketId: 'tk_1' },
      } as any)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    })
  })

  describe('handlePaymentFailed', () => {
    it('does nothing when ticketId is missing from metadata', async () => {
      await service.handlePaymentFailed({ id: 'pi_1', metadata: {} } as any)
      expect(mockPrisma.paymentLog.findFirst).not.toHaveBeenCalled()
    })

    it('does nothing when no initiated payment log is found', async () => {
      mockPrisma.paymentLog.findFirst.mockResolvedValue(null)
      await service.handlePaymentFailed({ id: 'pi_1', metadata: { ticketId: 'tk_2' } } as any)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('updates paymentLog to failed, ticket to cancelled, and increments inventory', async () => {
      mockPrisma.paymentLog.findFirst.mockResolvedValue({
        id: 'log_2',
        ticketId: 'tk_2',
        eventId: 'evt_1',
      })
      mockPrisma.$transaction.mockResolvedValue([])
      await service.handlePaymentFailed({
        id: 'pi_2',
        metadata: { ticketId: 'tk_2' },
        last_payment_error: { code: 'card_declined' },
      } as any)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(mockRedis.incr).toHaveBeenCalledWith('event:evt_1:inventory')
    })
  })
})
