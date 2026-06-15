import { Test } from '@nestjs/testing'
import { StripePaymentProvider } from '../../src/payment/providers/stripe.provider'
import { MetricsService } from '../../src/metrics/metrics.service'

describe('StripePaymentProvider', () => {
  let provider: StripePaymentProvider

  const mockStripe = {
    paymentIntents: { create: vi.fn() },
  }
  const mockMetrics = {
    paymentDurationSeconds: { startTimer: vi.fn().mockReturnValue(() => {}) },
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    const module = await Test.createTestingModule({
      providers: [
        StripePaymentProvider,
        { provide: 'STRIPE_CLIENT', useValue: mockStripe },
        { provide: MetricsService, useValue: mockMetrics },
      ],
    }).compile()
    provider = module.get(StripePaymentProvider)
  })

  it('returns success=true with PaymentIntent id as providerRef on success', async () => {
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_test_123', status: 'succeeded' })
    const result = await provider.charge({
      cardToken: 'pm_card_visa',
      amount: 99.99,
      idempotencyKey: 'ticket-uuid-1',
    })
    expect(result.success).toBe(true)
    expect(result.providerRef).toBe('pi_test_123')
    expect(result.failureReason).toBeNull()
  })

  it('converts dollar amount to cents', async () => {
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_2', status: 'succeeded' })
    await provider.charge({ cardToken: 'pm_card_visa', amount: 29.99, idempotencyKey: 'ticket-2' })
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2999 }),
      expect.anything(),
    )
  })

  it('passes ticketId in PaymentIntent metadata', async () => {
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_3', status: 'succeeded' })
    await provider.charge({ cardToken: 'pm_card_visa', amount: 10, idempotencyKey: 'ticket-abc' })
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { ticketId: 'ticket-abc' } }),
      expect.anything(),
    )
  })

  it('passes idempotencyKey to Stripe options', async () => {
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_4', status: 'succeeded' })
    await provider.charge({ cardToken: 'pm_card_visa', amount: 10, idempotencyKey: 'ticket-idem' })
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: 'ticket-idem' }),
    )
  })

  it('returns success=false with card_declined on StripeCardError', async () => {
    const cardError = Object.assign(new Error('card declined'), {
      type: 'StripeCardError',
      code: 'card_declined',
    })
    mockStripe.paymentIntents.create.mockRejectedValue(cardError)
    const result = await provider.charge({
      cardToken: 'pm_card_decline',
      amount: 50,
      idempotencyKey: 'ticket-fail',
    })
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('card_declined')
    expect(result.providerRef).toBeNull()
  })

  it('maps fraudulent Stripe error code to fraud', async () => {
    const cardError = Object.assign(new Error('fraud'), {
      type: 'StripeCardError',
      code: 'fraudulent',
    })
    mockStripe.paymentIntents.create.mockRejectedValue(cardError)
    const result = await provider.charge({
      cardToken: 'pm_card_decline',
      amount: 50,
      idempotencyKey: 'ticket-fraud',
    })
    expect(result.failureReason).toBe('fraud')
  })

  it('re-throws non-card Stripe errors', async () => {
    const networkError = Object.assign(new Error('network timeout'), {
      type: 'StripeConnectionError',
    })
    mockStripe.paymentIntents.create.mockRejectedValue(networkError)
    await expect(
      provider.charge({ cardToken: 'pm_card_visa', amount: 50, idempotencyKey: 'ticket-net' }),
    ).rejects.toThrow('network timeout')
  })
})
