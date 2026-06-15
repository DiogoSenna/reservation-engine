import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PaymentService } from './payment.service'
import { MockPaymentProvider } from './providers/mock.provider'
import { StripePaymentProvider } from './providers/stripe.provider'
import type { AppConfig } from '../config/configuration'
import Stripe from 'stripe'

@Module({
  providers: [
    {
      provide: 'STRIPE_CLIENT',
      useFactory: (config: ConfigService<AppConfig>) => {
        const key = config.get('STRIPE_SECRET_KEY', { infer: true })
        return key ? new Stripe(key) : null
      },
      inject: [ConfigService],
    },
    MockPaymentProvider,
    StripePaymentProvider,
    {
      provide: PaymentService,
      useFactory: (
        config: ConfigService<AppConfig>,
        stripe: StripePaymentProvider,
        mock: MockPaymentProvider,
      ) => {
        return config.get('PAYMENT_PROVIDER', { infer: true }) === 'stripe' ? stripe : mock
      },
      inject: [ConfigService, StripePaymentProvider, MockPaymentProvider],
    },
  ],
  exports: [PaymentService, 'STRIPE_CLIENT'],
})
export class PaymentModule {}
