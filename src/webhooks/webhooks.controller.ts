import { Controller, Post, Headers, BadRequestException, HttpCode, Inject } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WebhooksService } from './webhooks.service'
import { RawBody } from './decorators/raw-body.decorator'
import Stripe from 'stripe'
import type { AppConfig } from '../config/configuration'
import type { StripeWebhookEvent, StripePaymentIntent } from './stripe.types'

@Controller('webhooks')
export class WebhooksController {
  private readonly webhookSecret: string | undefined

  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: InstanceType<typeof Stripe> | null,
    config: ConfigService<AppConfig>,
    private readonly webhooksService: WebhooksService,
  ) {
    this.webhookSecret = config.get('STRIPE_WEBHOOK_SECRET', { infer: true })
  }

  @Post('stripe')
  @HttpCode(200)
  async handleStripeWebhook(
    @RawBody() rawBody: Buffer,
    @Headers('stripe-signature') sig: string,
  ): Promise<{ received: boolean }> {
    if (!this.stripe || !this.webhookSecret) {
      return { received: false }
    }

    let event: StripeWebhookEvent
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret)
    } catch {
      throw new BadRequestException('Invalid Stripe signature')
    }

    if (event.type === 'payment_intent.succeeded') {
      await this.webhooksService.handlePaymentSucceeded(event.data.object as StripePaymentIntent)
    } else if (event.type === 'payment_intent.payment_failed') {
      await this.webhooksService.handlePaymentFailed(event.data.object as StripePaymentIntent)
    }

    return { received: true }
  }
}
