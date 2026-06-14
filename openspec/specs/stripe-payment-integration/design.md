# Stripe Payment Integration — Design

**Date:** 2026-06-14  
**Status:** Approved

## Overview

Replace the mock-only `PaymentService` with a real Stripe integration while keeping the mock available as a togglable fallback via an environment variable. Add a webhook endpoint for supplementary async payment event handling.

---

## Architecture

### Provider abstraction

`PaymentService` becomes an abstract class that also serves as the NestJS DI token. Two concrete providers extend it:

```
src/payment/
  payment.service.ts          ← abstract class (DI token + shared interface)
  payment.module.ts           ← factory provider selects Stripe or Mock
  providers/
    stripe.provider.ts        ← Stripe PaymentIntents implementation
    mock.provider.ts          ← existing mock logic moved here
```

`PaymentModule` registers a factory provider:

```ts
{
  provide: PaymentService,
  useClass: config.get('PAYMENT_PROVIDER') === 'stripe'
    ? StripePaymentProvider
    : MockPaymentProvider,
}
```

`ReservationService` continues to inject `PaymentService` with no changes.

### Webhook module

```
src/webhooks/
  webhooks.module.ts
  webhooks.controller.ts      ← POST /webhooks/stripe
```

Depends only on `PrismaService` and `RedisService`, both already global.

---

## Stripe PaymentIntent Flow

`StripePaymentProvider.charge()` uses Stripe's PaymentIntents API:

1. Call `stripe.paymentIntents.create({ confirm: true, ... })` — creates and confirms synchronously
2. Set `metadata.ticketId = ticket.id` for webhook correlation
3. Pass `ticket.id` as the Stripe idempotency key — prevents double charges on retry
4. Map result:
   - `status: 'succeeded'` → `{ success: true, providerRef: paymentIntent.id, failureReason: null }`
   - `status: 'requires_action'` → `{ success: false, providerRef: null, failureReason: 'card_declined' }` (no frontend for 3DS)
   - Stripe SDK error → map to appropriate `PaymentFailureReason`

**Amount conversion:** `eventPrice` (number, dollars) × 100, rounded to integer cents.

**Payment method:** `User.cardToken` maps directly to a Stripe `PaymentMethod` ID. No Stripe Customer required.

---

## Webhook Endpoint

### Raw body handling

Stripe signature verification requires the raw request bytes. In `main.ts`, a custom Fastify body parser saves the raw buffer on the request object before JSON parsing. A `@RawBody()` decorator extracts it in the controller.

### `POST /webhooks/stripe`

1. Read `stripe-signature` header
2. Call `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)` — throws `400` if invalid
3. Handle events:

| Event | Precondition | Action |
|---|---|---|
| `payment_intent.succeeded` | `PaymentLog.status === 'initiated'` | Update `PaymentLog` → `success`, set `providerRef`. Update `Ticket` → `confirmed`. |
| `payment_intent.payment_failed` | `PaymentLog.status === 'initiated'` | Update `PaymentLog` → `failed`. Update `Ticket` → `cancelled`. Increment Redis inventory key. |

4. Return HTTP 200 for all events (including unhandled types) to prevent Stripe retries.

**Idempotency:** Both handlers guard on current status — safe to receive duplicate webhooks.

---

## Configuration

Three new env vars added to the Zod schema in `src/config/configuration.ts`:

| Variable | Type | Default | Required when |
|---|---|---|---|
| `PAYMENT_PROVIDER` | `'stripe' \| 'mock'` | `'mock'` | — |
| `STRIPE_SECRET_KEY` | `string` | — | `PAYMENT_PROVIDER=stripe` |
| `STRIPE_WEBHOOK_SECRET` | `string` | — | `PAYMENT_PROVIDER=stripe` |

A `.refine()` on the Zod schema enforces that `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are present when `PAYMENT_PROVIDER=stripe`. App fails fast at startup if misconfigured.

`.env.example` updated with all three vars and a note pointing to Stripe's test mode dashboard.

---

## Seed Data

`prisma/seed.ts` updates `cardToken` values to static Stripe test payment method IDs:

| User | cardToken | Behavior |
|---|---|---|
| Most seeded users | `pm_card_visa` | Always succeeds |
| One seeded user | `pm_card_decline` | Always declines |

These tokens work in Stripe test mode without any Stripe API call at seed time.

---

## Metrics

`paymentMockDurationSeconds` in `MetricsService` is renamed to `paymentDurationSeconds` with a `provider` label (`stripe` or `mock`). Both providers record to the same histogram. Grafana dashboard updated to match.

---

## Testing

**Unit tests**

`StripePaymentProvider` tested by injecting a mocked Stripe SDK instance — no network calls. Covers:
- Successful charge → `success: true`, `providerRef` set to PaymentIntent ID
- Stripe error (card_declined) → `success: false`, correct `failureReason`
- Amount conversion (dollars → cents)

**Integration tests**

`PAYMENT_PROVIDER=mock` (default) — all existing integration tests unaffected.

New integration test for the webhook endpoint:
- Invalid signature → HTTP 400
- Valid `payment_intent.succeeded` → ticket status becomes `confirmed`
- Valid `payment_intent.payment_failed` → ticket status becomes `cancelled`, Redis inventory incremented
- Duplicate webhook (already-confirmed ticket) → HTTP 200, no state change (idempotent)

---

## Out of Scope

- Stripe Customer creation / saved card management
- 3DS / `requires_action` frontend handling
- Refund flow (webhook `charge.refunded` event)
- Stripe radar / fraud rules
