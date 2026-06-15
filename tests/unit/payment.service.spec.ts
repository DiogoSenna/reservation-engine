import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { PaymentService } from '../../src/payment/payment.service'
import { MetricsService } from '../../src/metrics/metrics.service'

describe('PaymentService', () => {
  let service: PaymentService

  const mockConfig = { get: vi.fn() }
  const mockMetrics = {
    paymentDurationSeconds: { startTimer: vi.fn().mockReturnValue(() => {}) },
  }

  beforeEach(async () => {
    mockConfig.get.mockImplementation((key: string) => {
      const map: Record<string, any> = {
        PAYMENT_SUCCESS_RATE: 1,
        PAYMENT_FAILURE_MODES: 'card_declined',
        PAYMENT_MIN_LATENCY_MS: 0,
        PAYMENT_MAX_LATENCY_MS: 0,
      }
      return map[key]
    })

    const module = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: MetricsService, useValue: mockMetrics },
      ],
    }).compile()
    service = module.get(PaymentService)
  })

  it('returns success=true with providerRef when successRate=1', async () => {
    const result = await service.charge({ cardToken: 'tok', amount: 100, idempotencyKey: 'k1' })
    expect(result.success).toBe(true)
    expect(result.providerRef).toMatch(/^mock_/)
  })

  it('returns success=false with failureReason when successRate=0', async () => {
    mockConfig.get.mockImplementation((key: string) => {
      const map: Record<string, any> = {
        PAYMENT_SUCCESS_RATE: 0,
        PAYMENT_FAILURE_MODES: 'card_declined',
        PAYMENT_MIN_LATENCY_MS: 0,
        PAYMENT_MAX_LATENCY_MS: 0,
      }
      return map[key]
    })
    const freshModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: MetricsService, useValue: mockMetrics },
      ],
    }).compile()
    const svc = freshModule.get(PaymentService)
    const result = await svc.charge({ cardToken: 'tok', amount: 100, idempotencyKey: 'k2' })
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('card_declined')
  })
})
