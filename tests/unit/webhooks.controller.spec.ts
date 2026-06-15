import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WebhooksController } from '../../src/webhooks/webhooks.controller'
import { WebhooksService } from '../../src/webhooks/webhooks.service'

describe('WebhooksController', () => {
  let controller: WebhooksController

  const validSecret = 'whsec_test_secret_for_unit_tests_here'
  const mockStripe = {
    webhooks: { constructEvent: vi.fn() },
  }
  const mockWebhooksService = {
    handlePaymentSucceeded: vi.fn(),
    handlePaymentFailed: vi.fn(),
  }
  const mockConfig = { get: vi.fn() }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'STRIPE_WEBHOOK_SECRET') return validSecret
      return undefined
    })

    const module = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: 'STRIPE_CLIENT', useValue: mockStripe },
        { provide: WebhooksService, useValue: mockWebhooksService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    controller = module.get(WebhooksController)
  })

  it('throws BadRequestException when Stripe signature is invalid', async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature')
    })
    await expect(
      controller.handleStripeWebhook(Buffer.from('{}'), 'bad-sig'),
    ).rejects.toThrow(BadRequestException)
  })

  it('returns { received: true } for unknown event types', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'customer.created',
      data: { object: {} },
    })
    const result = await controller.handleStripeWebhook(Buffer.from('{}'), 'valid-sig')
    expect(result).toEqual({ received: true })
  })

  it('delegates payment_intent.succeeded to WebhooksService', async () => {
    const fakeIntent = { id: 'pi_1', metadata: { ticketId: 'ticket-1' } }
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: fakeIntent },
    })
    await controller.handleStripeWebhook(Buffer.from('{}'), 'valid-sig')
    expect(mockWebhooksService.handlePaymentSucceeded).toHaveBeenCalledWith(fakeIntent)
  })

  it('delegates payment_intent.payment_failed to WebhooksService', async () => {
    const fakeIntent = { id: 'pi_2', metadata: { ticketId: 'ticket-2' } }
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: { object: fakeIntent },
    })
    await controller.handleStripeWebhook(Buffer.from('{}'), 'valid-sig')
    expect(mockWebhooksService.handlePaymentFailed).toHaveBeenCalledWith(fakeIntent)
  })

  it('returns { received: false } when Stripe is not configured', async () => {
    mockConfig.get.mockReturnValue(undefined)
    const freshModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: 'STRIPE_CLIENT', useValue: null },
        { provide: WebhooksService, useValue: mockWebhooksService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    const unconfigured = freshModule.get(WebhooksController)
    const result = await unconfigured.handleStripeWebhook(Buffer.from('{}'), '')
    expect(result).toEqual({ received: false })
  })
})
