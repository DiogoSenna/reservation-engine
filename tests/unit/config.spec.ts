import { configuration } from '../../src/config/configuration'

describe('configuration()', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    REDIS_URL: 'redis://x',
    JWT_SECRET: 'aaaaaaaaaaaaaaaa',
  }

  afterEach(() => {
    delete process.env.PAYMENT_PROVIDER
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
  })

  it('loads with defaults when PAYMENT_PROVIDER is not set', () => {
    Object.assign(process.env, base)
    const config = configuration()
    expect(config.PAYMENT_PROVIDER).toBe('mock')
  })

  it('throws when PAYMENT_PROVIDER=stripe and Stripe keys are missing', () => {
    Object.assign(process.env, { ...base, PAYMENT_PROVIDER: 'stripe' })
    expect(() => configuration()).toThrow('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required')
  })

  it('succeeds when PAYMENT_PROVIDER=stripe with both Stripe keys present', () => {
    Object.assign(process.env, {
      ...base,
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_fake_secret_here_long_enough',
    })
    const config = configuration()
    expect(config.PAYMENT_PROVIDER).toBe('stripe')
    expect(config.STRIPE_SECRET_KEY).toBe('sk_test_fake')
  })
})
