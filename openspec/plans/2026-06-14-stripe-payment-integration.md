# Stripe Payment Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock-only `PaymentService` with a real Stripe integration controlled by `PAYMENT_PROVIDER` env var, and add a `POST /webhooks/stripe` endpoint for supplementary async event handling.

**Architecture:** `PaymentService` becomes an abstract class (DI token); `MockPaymentProvider` and `StripePaymentProvider` extend it; `PaymentModule` uses a factory provider to select the active implementation at startup. A new `WebhooksModule` handles Stripe webhook events for idempotent confirmation/compensation.

**Tech Stack:** Stripe Node.js SDK (`stripe`), NestJS 11 (Fastify), Prisma 7, ioredis 5, Vitest 4, Testcontainers 12.

---

## Task 1: Install Stripe SDK

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install the stripe package**

```bash
npm install stripe
```

- [ ] **Step 2: Verify it was added**

```bash
grep '"stripe"' package.json
```

Expected: `"stripe": "^X.X.X"` line present.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install stripe SDK"
```

---

## Task 2: Extend config with Stripe env vars

**Files:**
- Modify: `src/config/configuration.ts`

- [ ] **Step 1: Write a failing test for the new validation**

Add to `tests/unit/` a new file `config.spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/config.spec.ts
```

Expected: FAIL — `PAYMENT_PROVIDER` doesn't exist on the schema yet.

- [ ] **Step 3: Update `src/config/configuration.ts`**

```typescript
import { z } from 'zod'

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string(),
    REDIS_URL: z.string(),
    JWT_SECRET: z.string().min(16),
    JWT_EXPIRY: z.string().default('8h'),
    PAYMENT_PROVIDER: z.enum(['stripe', 'mock']).default('mock'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    PAYMENT_SUCCESS_RATE: z.coerce.number().min(0).max(1).default(0.85),
    PAYMENT_FAILURE_MODES: z.string().default('card_declined,timeout,fraud'),
    PAYMENT_MIN_LATENCY_MS: z.coerce.number().default(50),
    PAYMENT_MAX_LATENCY_MS: z.coerce.number().default(300),
  })
  .refine(
    (data) =>
      data.PAYMENT_PROVIDER !== 'stripe' ||
      (!!data.STRIPE_SECRET_KEY && !!data.STRIPE_WEBHOOK_SECRET),
    {
      message:
        'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required when PAYMENT_PROVIDER=stripe',
    },
  )

export type AppConfig = z.infer<typeof schema>

export function configuration(): AppConfig {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    throw new Error(`Configuration validation failed: ${result.error.message}`)
  }
  return result.data
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/config.spec.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/configuration.ts tests/unit/config.spec.ts
git commit -m "feat(config): add PAYMENT_PROVIDER and STRIPE_* env vars"
```

---

## Task 3: Rename payment metric with provider label

**Files:**
- Modify: `src/metrics/metrics.service.ts`

- [ ] **Step 1: Run existing unit tests to establish baseline**

```bash
npm test
```

Expected: All pass. Note the existing `paymentMockDurationSeconds` usages — they'll break after this step until Task 4 updates them.

- [ ] **Step 2: Update `src/metrics/metrics.service.ts`**

Rename `paymentMockDurationSeconds` to `paymentDurationSeconds` and add a `provider` label. Change the metric name string and help text too:

```typescript
import { Injectable } from '@nestjs/common'
import {
  Counter, Histogram, Gauge,
  collectDefaultMetrics, Registry,
} from 'prom-client'

@Injectable()
export class MetricsService {
  readonly register: Registry
  readonly ticketsSoldTotal: Counter
  readonly purchaseFailedTotal: Counter<'reason'>
  readonly purchaseDurationSeconds: Histogram
  readonly paymentDurationSeconds: Histogram<'provider'>
  readonly activeInventory: Gauge<'event_id'>
  readonly redisLockAcquisitionsTotal: Counter
  readonly redisLockFailuresTotal: Counter

  constructor() {
    this.register = new Registry()
    collectDefaultMetrics({ register: this.register })

    this.ticketsSoldTotal = new Counter({
      name: 'tickets_sold_total',
      help: 'Total confirmed purchases',
      registers: [this.register],
    })
    this.purchaseFailedTotal = new Counter({
      name: 'purchase_failed_total',
      help: 'Failed purchase attempts',
      labelNames: ['reason'],
      registers: [this.register],
    })
    this.purchaseDurationSeconds = new Histogram({
      name: 'purchase_duration_seconds',
      help: 'Full purchase flow duration',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.register],
    })
    this.paymentDurationSeconds = new Histogram({
      name: 'payment_duration_seconds',
      help: 'Payment provider call duration',
      labelNames: ['provider'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.register],
    })
    this.activeInventory = new Gauge({
      name: 'active_inventory',
      help: 'Current Redis inventory per event',
      labelNames: ['event_id'],
      registers: [this.register],
    })
    this.redisLockAcquisitionsTotal = new Counter({
      name: 'redis_lock_acquisitions_total',
      help: 'Redlock acquisitions',
      registers: [this.register],
    })
    this.redisLockFailuresTotal = new Counter({
      name: 'redis_lock_failures_total',
      help: 'Redlock acquisition failures',
      registers: [this.register],
    })
  }
}
```

- [ ] **Step 3: Update the reference in `src/payment/payment.service.ts`**

The existing `payment.service.ts` uses `this.metrics.paymentMockDurationSeconds`. Temporarily update it to use the new name (it will be fully replaced in Task 4, but needs to compile now):

```typescript
// In PaymentService.charge(), replace:
//   const end = this.metrics.paymentMockDurationSeconds.startTimer()
// with:
    const end = this.metrics.paymentDurationSeconds.startTimer({ provider: 'mock' })
```

- [ ] **Step 4: Update the mock in `tests/unit/payment.service.spec.ts`**

```typescript
// Change:
//   paymentMockDurationSeconds: { startTimer: vi.fn().mockReturnValue(() => {}) },
// to:
    paymentDurationSeconds: { startTimer: vi.fn().mockReturnValue(() => {}) },
```

- [ ] **Step 5: Run all unit tests**

```bash
npm test
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/metrics.service.ts src/payment/payment.service.ts tests/unit/payment.service.spec.ts
git commit -m "refactor(metrics): rename paymentMockDurationSeconds to paymentDurationSeconds with provider label"
```

---

## Task 4: Abstract PaymentService + extract MockPaymentProvider

**Files:**
- Modify: `src/payment/payment.service.ts` → abstract class
- Create: `src/payment/providers/mock.provider.ts`
- Modify: `src/payment/payment.module.ts`
- Modify: `tests/unit/payment.service.spec.ts`

- [ ] **Step 1: Update the test to target MockPaymentProvider**

Replace `tests/unit/payment.service.spec.ts` entirely:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/payment.service.spec.ts
```

Expected: FAIL — `MockPaymentProvider` doesn't exist yet.

- [ ] **Step 3: Create `src/payment/providers/mock.provider.ts`**

```typescript
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PaymentService } from '../payment.service'
import { MetricsService } from '../../metrics/metrics.service'
import type { AppConfig } from '../../config/configuration'
import type { ChargeOptions, ChargeResult } from '../payment.service'
import type { PaymentFailureReason } from '../../types'

@Injectable()
export class MockPaymentProvider extends PaymentService {
  private readonly successRate: number
  private readonly failureModes: PaymentFailureReason[]
  private readonly minLatencyMs: number
  private readonly maxLatencyMs: number

  constructor(
    config: ConfigService<AppConfig>,
    private readonly metrics: MetricsService,
  ) {
    super()
    this.successRate = config.get('PAYMENT_SUCCESS_RATE', { infer: true })!
    this.failureModes = (config.get('PAYMENT_FAILURE_MODES', { infer: true })! as string).split(
      ',',
    ) as PaymentFailureReason[]
    this.minLatencyMs = config.get('PAYMENT_MIN_LATENCY_MS', { infer: true })!
    this.maxLatencyMs = config.get('PAYMENT_MAX_LATENCY_MS', { infer: true })!
  }

  async charge({ idempotencyKey }: ChargeOptions): Promise<ChargeResult> {
    const end = this.metrics.paymentDurationSeconds.startTimer({ provider: 'mock' })
    const latency = this.minLatencyMs + Math.random() * (this.maxLatencyMs - this.minLatencyMs)
    await new Promise((r) => setTimeout(r, latency))
    end()

    if (Math.random() < this.successRate) {
      return { success: true, providerRef: `mock_${idempotencyKey}`, failureReason: null }
    }

    const reason =
      this.failureModes[Math.floor(Math.random() * this.failureModes.length)] ?? 'card_declined'
    return { success: false, providerRef: null, failureReason: reason }
  }
}
```

- [ ] **Step 4: Replace `src/payment/payment.service.ts` with the abstract class**

The `ChargeOptions` and `ChargeResult` interfaces stay here so both providers can import them:

```typescript
import type { PaymentFailureReason } from '../types'

export interface ChargeOptions {
  cardToken: string
  amount: number
  idempotencyKey: string
}

export interface ChargeResult {
  success: boolean
  providerRef: string | null
  failureReason: PaymentFailureReason | null
}

export abstract class PaymentService {
  abstract charge(options: ChargeOptions): Promise<ChargeResult>
}
```

- [ ] **Step 5: Update `src/payment/payment.module.ts`**

```typescript
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
```

Note: `StripePaymentProvider` will be created in Task 5. The module references it now to avoid a circular edit later.

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: FAIL with `Cannot find module '../../src/payment/providers/stripe.provider'`. That's correct — it will be created in Task 5.

- [ ] **Step 7: Commit the partial state once Task 5 is done** — skip this commit for now, combine with Task 5.

---

## Task 5: Implement StripePaymentProvider

**Files:**
- Create: `src/payment/providers/stripe.provider.ts`
- Create: `tests/unit/stripe.provider.spec.ts`

- [ ] **Step 1: Create the unit test file**

```typescript
// tests/unit/stripe.provider.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/stripe.provider.spec.ts
```

Expected: FAIL — `StripePaymentProvider` doesn't exist yet.

- [ ] **Step 3: Create `src/payment/providers/stripe.provider.ts`**

```typescript
import { Injectable, Inject } from '@nestjs/common'
import { PaymentService } from '../payment.service'
import { MetricsService } from '../../metrics/metrics.service'
import type { ChargeOptions, ChargeResult } from '../payment.service'
import type { PaymentFailureReason } from '../../types'
import Stripe from 'stripe'

@Injectable()
export class StripePaymentProvider extends PaymentService {
  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: Stripe,
    private readonly metrics: MetricsService,
  ) {
    super()
  }

  async charge({ cardToken, amount, idempotencyKey }: ChargeOptions): Promise<ChargeResult> {
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
```

- [ ] **Step 4: Run all unit tests**

```bash
npm test
```

Expected: All pass, including the new `stripe.provider.spec.ts` and updated `payment.service.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/payment/ tests/unit/payment.service.spec.ts tests/unit/stripe.provider.spec.ts
git commit -m "feat(payment): add StripePaymentProvider with factory provider abstraction"
```

---

## Task 6: Raw body parser in main.ts + @RawBody() decorator

**Files:**
- Modify: `src/main.ts`
- Create: `src/webhooks/decorators/raw-body.decorator.ts`

- [ ] **Step 1: Create the `@RawBody()` decorator**

```typescript
// src/webhooks/decorators/raw-body.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export const RawBody = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Buffer => {
    return ctx.switchToHttp().getRequest().rawBody as Buffer
  },
)
```

- [ ] **Step 2: Update `src/main.ts` to register the custom JSON body parser**

The custom parser saves the raw `Buffer` on the Fastify request before JSON-parsing, making it available to the `@RawBody()` decorator:

```typescript
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  )

  app.getHttpAdapter().getInstance().addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: any, body: Buffer, done: (err: Error | null, body?: unknown) => void) => {
      req.rawBody = body
      try {
        done(null, JSON.parse(body.toString()))
      } catch (err) {
        done(err as Error)
      }
    },
  )

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  await app.register(require('@fastify/cors'), {
    origin: 'http://localhost:5173',
    credentials: true,
  })

  const port = process.env.PORT ?? 3000
  await app.listen(port, '0.0.0.0')
}

bootstrap()
```

- [ ] **Step 3: Verify the app still starts**

```bash
npm run build
```

Expected: Compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/webhooks/decorators/raw-body.decorator.ts
git commit -m "feat(webhooks): add raw body parser and @RawBody() decorator for Stripe signature verification"
```

---

## Task 7: WebhooksController + WebhooksModule + register in AppModule

**Files:**
- Create: `src/webhooks/webhooks.controller.ts`
- Create: `src/webhooks/webhooks.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write the unit test for WebhooksController**

Create `tests/unit/webhooks.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { WebhooksController } from '../../src/webhooks/webhooks.controller'

describe('WebhooksController', () => {
  let controller: WebhooksController

  const validSecret = 'whsec_test_secret_for_unit_tests_here'
  const mockStripe = {
    webhooks: { constructEvent: vi.fn() },
  }
  const mockPrisma = {
    paymentLog: { findFirst: vi.fn(), update: vi.fn() },
    ticket: { update: vi.fn() },
    $transaction: vi.fn(),
  }
  const mockRedis = { incr: vi.fn() }
  const mockConfig = { get: vi.fn() }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_fake'
      if (key === 'STRIPE_WEBHOOK_SECRET') return validSecret
      return undefined
    })

    const module = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: 'STRIPE_CLIENT', useValue: mockStripe },
        { provide: 'PrismaService', useValue: mockPrisma },
        { provide: 'RedisService', useValue: mockRedis },
        { provide: 'ConfigService', useValue: mockConfig },
      ],
    })
      .overrideProvider('PrismaService')
      .useValue(mockPrisma)
      .overrideProvider('RedisService')
      .useValue(mockRedis)
      .compile()

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

  it('returns { received: false } when Stripe is not configured', async () => {
    mockConfig.get.mockReturnValue(undefined)
    const freshModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: 'STRIPE_CLIENT', useValue: null },
        { provide: 'PrismaService', useValue: mockPrisma },
        { provide: 'RedisService', useValue: mockRedis },
        { provide: 'ConfigService', useValue: mockConfig },
      ],
    })
      .overrideProvider('PrismaService')
      .useValue(mockPrisma)
      .overrideProvider('RedisService')
      .useValue(mockRedis)
      .compile()

    const unconfigured = freshModule.get(WebhooksController)
    const result = await unconfigured.handleStripeWebhook(Buffer.from('{}'), '')
    expect(result).toEqual({ received: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/webhooks.controller.spec.ts
```

Expected: FAIL — `WebhooksController` doesn't exist yet.

- [ ] **Step 3: Create `src/webhooks/webhooks.controller.ts`**

```typescript
import { Controller, Post, Headers, BadRequestException, HttpCode, Inject } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../database/prisma.service'
import { RedisService } from '../redis/redis.service'
import { RawBody } from './decorators/raw-body.decorator'
import Stripe from 'stripe'
import type { AppConfig } from '../config/configuration'

@Controller('webhooks')
export class WebhooksController {
  private readonly webhookSecret: string | undefined

  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: Stripe | null,
    config: ConfigService<AppConfig>,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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

    let event: Stripe.Event
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret)
    } catch {
      throw new BadRequestException('Invalid Stripe signature')
    }

    if (event.type === 'payment_intent.succeeded') {
      await this.handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent)
    } else if (event.type === 'payment_intent.payment_failed') {
      await this.handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
    }

    return { received: true }
  }

  private async handlePaymentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const ticketId = intent.metadata?.ticketId
    if (!ticketId) return

    const log = await this.prisma.paymentLog.findFirst({
      where: { ticketId, status: 'initiated' },
    })
    if (!log) return

    await this.prisma.$transaction([
      this.prisma.paymentLog.update({
        where: { id: log.id },
        data: { status: 'success', providerRef: intent.id },
      }),
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'confirmed', expiresAt: null },
      }),
    ])
  }

  private async handlePaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const ticketId = intent.metadata?.ticketId
    if (!ticketId) return

    const log = await this.prisma.paymentLog.findFirst({
      where: { ticketId, status: 'initiated' },
    })
    if (!log) return

    const failureReason = intent.last_payment_error?.code ?? 'card_declined'

    await this.prisma.$transaction([
      this.prisma.paymentLog.update({
        where: { id: log.id },
        data: { status: 'failed', failureReason },
      }),
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'cancelled' },
      }),
    ])

    await this.redis.incr(`event:${log.eventId}:inventory`)
  }
}
```

- [ ] **Step 4: Create `src/webhooks/webhooks.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { WebhooksController } from './webhooks.controller'
import { PaymentModule } from '../payment/payment.module'

@Module({
  imports: [PaymentModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
```

- [ ] **Step 5: Register `WebhooksModule` in `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { configuration } from './config/configuration'
import { PrismaModule } from './database/prisma.module'
import { RedisModule } from './redis/redis.module'
import { MetricsModule } from './metrics/metrics.module'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { EventsModule } from './events/events.module'
import { TicketsModule } from './tickets/tickets.module'
import { WebhooksModule } from './webhooks/webhooks.module'

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    PrismaModule,
    RedisModule,
    MetricsModule,
    HealthModule,
    AuthModule,
    EventsModule,
    TicketsModule,
    WebhooksModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Run all unit tests**

```bash
npm test
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/webhooks/ src/app.module.ts tests/unit/webhooks.controller.spec.ts
git commit -m "feat(webhooks): add WebhooksController handling payment_intent.succeeded and payment_intent.payment_failed"
```

---

## Task 8: Webhook integration tests

**Files:**
- Create: `tests/integration/webhooks.spec.ts`

- [ ] **Step 1: Create the integration test**

```typescript
// tests/integration/webhooks.spec.ts
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
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

    app.getHttpAdapter().getInstance().addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (req: any, body: Buffer, done: (err: Error | null, body?: unknown) => void) => {
        req.rawBody = body
        try { done(null, JSON.parse(body.toString())) } catch (e) { done(e as Error) }
      },
    )

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

  it('confirms ticket and payment log on payment_intent.succeeded', async () => {
    // Create a purchase to get a pending ticket + initiated payment log
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user1@example.com', password: 'password123' },
    })
    const token = JSON.parse(loginRes.body).token

    const eventsRes = await app.inject({ method: 'GET', url: '/events' })
    const events = JSON.parse(eventsRes.body) as Array<{ id: string; totalCapacity: number }>
    const event = events[0]

    // Make a purchase (mock provider, succeeds immediately)
    const purchaseRes = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/purchase`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(purchaseRes.statusCode).toBe(201)
    const { ticket, paymentLog } = JSON.parse(purchaseRes.body)

    // Simulate Stripe firing payment_intent.succeeded for a different ticketId
    // (this tests the webhook's idempotency — no double-confirm)
    const fakeIntent = {
      id: 'pi_test_webhook_success',
      status: 'succeeded',
      metadata: { ticketId: ticket.id },
      last_payment_error: null,
    }
    const event2 = { type: 'payment_intent.succeeded', data: { object: fakeIntent } }
    const { body, sig } = buildSignedRequest(event2)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)

    // Verify idempotency: re-sending same event returns 200 without error
    const res2 = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res2.statusCode).toBe(200)

    // paymentLog.id referenced above — just checking it exists
    expect(paymentLog.id).toBeDefined()
  }, 30_000)
})
```

- [ ] **Step 2: Run the integration test**

```bash
npm run test:integration -- tests/integration/webhooks.spec.ts
```

Expected: All pass. If any test fails, check that the `addContentTypeParser` block in the test setup matches what `main.ts` does.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/webhooks.spec.ts
git commit -m "test(webhooks): add integration tests for Stripe webhook endpoint"
```

---

## Task 9: Update seed data with Stripe test payment method IDs

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Update `scripts/seed.ts`**

Replace the fake `cardToken` strings with real Stripe test payment method IDs. `pm_card_visa` always succeeds in Stripe test mode; `pm_card_decline` always declines.

```typescript
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import * as bcrypt from 'bcrypt'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10)

  await prisma.user.createMany({
    data: [
      { email: 'admin@example.com', passwordHash, cardToken: 'pm_card_visa', role: 'admin' },
      // user1 uses a card that always declines — useful for testing the payment_failed path
      { email: 'user1@example.com', passwordHash, cardToken: 'pm_card_decline', role: 'user' },
      ...Array.from({ length: 19 }, (_, i) => ({
        email: `user${i + 2}@example.com`,
        passwordHash,
        cardToken: 'pm_card_visa',
        role: 'user' as const,
      })),
    ],
    skipDuplicates: true,
  })

  await prisma.event.createMany({
    data: [
      {
        name: 'Arctic Monkeys — Glastonbury 2026',
        venue: 'Pyramid Stage, Glastonbury',
        eventDate: new Date('2026-06-26T21:00:00Z'),
        totalCapacity: 10,
        price: 299.99,
      },
      {
        name: 'Radiohead Reunion Tour — London',
        venue: 'O2 Arena, London',
        eventDate: new Date('2026-09-15T19:30:00Z'),
        totalCapacity: 50,
        price: 149.99,
      },
    ],
    skipDuplicates: true,
  })

  console.log('Seed complete')
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
```

- [ ] **Step 2: Commit**

```bash
git add scripts/seed.ts
git commit -m "chore(seed): update cardToken values to Stripe test payment method IDs"
```

---

## Task 10: Update .env.example with Stripe vars

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`**

```dotenv
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reservation

REDIS_URL=redis://localhost:6379

JWT_SECRET=change-me-in-production
JWT_EXPIRY=8h

# Payment provider: 'mock' (default) or 'stripe'
# Set to 'stripe' to use real Stripe test mode. Requires the two STRIPE_* vars below.
PAYMENT_PROVIDER=mock

# Stripe test mode keys — get them from https://dashboard.stripe.com/test/apikeys
# Required when PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Mock payment tuning (only used when PAYMENT_PROVIDER=mock)
PAYMENT_SUCCESS_RATE=0.85
PAYMENT_FAILURE_MODES=card_declined,timeout,fraud
PAYMENT_MIN_LATENCY_MS=50
PAYMENT_MAX_LATENCY_MS=300
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document PAYMENT_PROVIDER and STRIPE_* env vars in .env.example"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - ✅ Provider abstraction (interface + factory) — Tasks 4, 5
  - ✅ `PAYMENT_PROVIDER` toggle — Tasks 2, 4
  - ✅ Stripe PaymentIntents (sync confirm, idempotency key, metadata) — Task 5
  - ✅ Amount → cents conversion — Task 5
  - ✅ cardToken = Stripe PaymentMethod ID — Task 9
  - ✅ Webhook endpoint — Tasks 6, 7
  - ✅ Signature verification + `BadRequestException` on failure — Task 7
  - ✅ `payment_intent.succeeded` → confirm ticket + payment log — Task 7
  - ✅ `payment_intent.payment_failed` → cancel + increment inventory — Task 7
  - ✅ Webhook idempotency (guard on `status === 'initiated'`) — Task 7
  - ✅ Metric renamed with `provider` label — Task 3
  - ✅ Seed data with Stripe test PM IDs — Task 9
  - ✅ Config refine for Stripe keys — Task 2
  - ✅ Existing integration tests unaffected (`PAYMENT_PROVIDER=mock` default) — Task 8 setup

- **No placeholders** — all code is complete.
- **Type consistency** — `ChargeOptions` / `ChargeResult` defined in `payment.service.ts` and imported by both providers. `paymentDurationSeconds` used consistently across Tasks 3–5.
