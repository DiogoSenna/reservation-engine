import { Injectable, Inject } from '@nestjs/common'
import { PaymentService } from '../payment.service'
import { MetricsService } from '../../metrics/metrics.service'
import type { ChargeOptions, ChargeResult } from '../payment.service'
import type { PaymentFailureReason } from '../../types'
import Stripe from 'stripe'

@Injectable()
export class StripePaymentProvider extends PaymentService {
  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: InstanceType<typeof Stripe> | null,
    private readonly metrics: MetricsService,
  ) {
    super()
  }

  async charge({ cardToken, amount, idempotencyKey }: ChargeOptions): Promise<ChargeResult> {
    if (!this.stripe) {
      throw new Error('Stripe client is not configured')
    }
    const end = this.metrics.paymentDurationSeconds.startTimer({ provider: 'stripe' })
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: Math.round(amount * 100),
          currency: 'usd',
          payment_method: cardToken,
          payment_method_types: ['card'],
          confirm: true,
          metadata: { ticketId: idempotencyKey },
        },
        { idempotencyKey },
      )
      end()
      if (intent.status === 'succeeded') {
        return { success: true, providerRef: intent.id, failureReason: null }
      }
      return { success: false, providerRef: null, failureReason: 'card_declined' }
    } catch (err: any) {
      end()
      if (err.type === 'StripeCardError') {
        return { success: false, providerRef: null, failureReason: this.mapCode(err.code) }
      }
      throw err
    }
  }

  private mapCode(code: string | undefined): PaymentFailureReason {
    if (code === 'fraudulent' || code === 'stolen_card') return 'fraud'
    if (code === 'call_issuer') return 'timeout'
    return 'card_declined'
  }
}
