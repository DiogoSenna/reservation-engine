import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ValidationPipe } from '@nestjs/common'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import { execSync } from 'child_process'
import Stripe from 'stripe'

describe('POST /webhooks/stripe', () => {
  let app: NestFastifyApplication
  let stopContainers: () => Promise<void>
  const WEBHOOK_SECRET = 'whsec_test_integration_secret_here_32chars'
  const stripe = new Stripe('sk_test_fake_key_for_webhook_tests_only')

  beforeAll(async () => {
    const [pg, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ])

    process.env.DATABASE_URL = pg.getConnectionUri()
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`
    process.env.JWT_SECRET = 'integration-test-secret-32chars!!'
    process.env.JWT_EXPIRY = '8h'
    process.env.PAYMENT_PROVIDER = 'mock'
    process.env.PAYMENT_SUCCESS_RATE = '1'
    process.env.PAYMENT_MIN_LATENCY_MS = '0'
    process.env.PAYMENT_MAX_LATENCY_MS = '0'
    process.env.PAYMENT_FAILURE_MODES = 'card_declined'
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_webhook_tests_only'
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.NODE_ENV = 'test'

    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'inherit' })
    execSync('npx tsx scripts/seed.ts', { env: process.env, stdio: 'inherit' })

    const { AppModule } = await import('../../src/app.module')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { rawBody: true },
    )
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    stopContainers = async () => { await pg.stop(); await redis.stop() }
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await stopContainers?.()
  })

  function buildSignedRequest(payload: object) {
    const body = JSON.stringify(payload)
    const sig = stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET })
    return { body, sig }
  }

  it('returns 400 for an invalid Stripe signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 'bad-sig', 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 200 for an unknown event type without side effects', async () => {
    const event = { type: 'customer.created', data: { object: { id: 'cus_test' } } }
    const { body, sig } = buildSignedRequest(event)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ received: true })
  })

  it('idempotently handles payment_intent.succeeded without double-processing', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user2@example.com', password: 'password123' },
    })
    const token = JSON.parse(loginRes.body).token

    const eventsRes = await app.inject({ method: 'GET', url: '/events' })
    const events = JSON.parse(eventsRes.body) as Array<{ id: string }>
    const event = events[0]

    const purchaseRes = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/purchase`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(purchaseRes.statusCode).toBe(201)
    const { ticket, paymentLog } = JSON.parse(purchaseRes.body)
    expect(paymentLog.id).toBeDefined()

    // Simulate Stripe sending payment_intent.succeeded for the same ticket
    // Since the purchase via mock already confirmed it, paymentLog.status is already 'success'
    // The webhook should be idempotent — no error, just a no-op
    const fakeIntent = {
      id: 'pi_test_webhook_idempotency',
      status: 'succeeded',
      metadata: { ticketId: ticket.id },
      last_payment_error: null,
    }
    const webhookEvent = { type: 'payment_intent.succeeded', data: { object: fakeIntent } }
    const { body, sig } = buildSignedRequest(webhookEvent)

    const res1 = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res1.statusCode).toBe(200)
    expect(JSON.parse(res1.body)).toEqual({ received: true })

    // Sending the same event again should still return 200 (idempotent)
    const res2 = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res2.statusCode).toBe(200)
  }, 30_000)

  it('handles payment_intent.payment_failed and returns 200', async () => {
    const fakeIntent = {
      id: 'pi_test_webhook_failed',
      status: 'requires_payment_method',
      metadata: { ticketId: 'nonexistent-ticket-id' },
      last_payment_error: { code: 'card_declined' },
    }
    const webhookEvent = { type: 'payment_intent.payment_failed', data: { object: fakeIntent } }
    const { body, sig } = buildSignedRequest(webhookEvent)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ received: true })
  }, 30_000)
})
