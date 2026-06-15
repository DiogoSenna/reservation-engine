import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { MockPaymentProvider } from '../../src/payment/providers/mock.provider'
import { MetricsService } from '../../src/metrics/metrics.service'

describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider

  const mockConfig = { get: vi.fn() }
  const mockMetrics = {
    paymentDurationSeconds: { startTimer: vi.fn().mockReturnValue(() => {}) },
  }

  beforeEach(async () => {
    mockConfig.get.mockImplementation((key: string) => {
      const map: Record<string, unknown> = {
        PAYMENT_SUCCESS_RATE: 1,
        PAYMENT_FAILURE_MODES: 'card_declined',
        PAYMENT_MIN_LATENCY_MS: 0,
        PAYMENT_MAX_LATENCY_MS: 0,
      }
      return map[key]
    })

    const module = await Test.createTestingModule({
      providers: [
        MockPaymentProvider,
        { provide: ConfigService, useValue: mockConfig },
        { provide: MetricsService, useValue: mockMetrics },
      ],
    }).compile()
    provider = module.get(MockPaymentProvider)
  })

  it('returns success=true with providerRef when successRate=1', async () => {
    const result = await provider.charge({ cardToken: 'tok', amount: 100, idempotencyKey: 'k1' })
    expect(result.success).toBe(true)
    expect(result.providerRef).toMatch(/^mock_/)
  })

  it('returns success=false with failureReason when successRate=0', async () => {
    mockConfig.get.mockImplementation((key: string) => {
      const map: Record<string, unknown> = {
        PAYMENT_SUCCESS_RATE: 0,
        PAYMENT_FAILURE_MODES: 'card_declined',
        PAYMENT_MIN_LATENCY_MS: 0,
        PAYMENT_MAX_LATENCY_MS: 0,
      }
      return map[key]
    })
    const freshModule = await Test.createTestingModule({
      providers: [
        MockPaymentProvider,
        { provide: ConfigService, useValue: mockConfig },
        { provide: MetricsService, useValue: mockMetrics },
      ],
    }).compile()
    const svc = freshModule.get(MockPaymentProvider)
    const result = await svc.charge({ cardToken: 'tok', amount: 100, idempotencyKey: 'k2' })
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('card_declined')
  })
})
