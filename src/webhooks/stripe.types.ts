import Stripe from 'stripe'

type StripeInstance = InstanceType<typeof Stripe>

export type StripeWebhookEvent = ReturnType<StripeInstance['webhooks']['constructEvent']>
export type StripePaymentIntent = Awaited<ReturnType<StripeInstance['paymentIntents']['retrieve']>>
