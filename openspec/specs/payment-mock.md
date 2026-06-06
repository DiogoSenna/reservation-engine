# Payment Mock Spec

Simulates an external payment provider (Stripe-like).

**Configuration (env vars):**
- `PAYMENT_SUCCESS_RATE` — 0–1, probability of success (default: 0.85)
- `PAYMENT_FAILURE_MODES` — comma-separated: `card_declined`, `timeout`, `fraud`
- `PAYMENT_MIN_LATENCY_MS` / `PAYMENT_MAX_LATENCY_MS` — simulated latency range

**Behaviour:**
- Adds random latency on every call
- On success: `{ success: true, providerRef: "mock_{idempotencyKey}" }`
- On failure: `{ success: false, failureReason }` (random from configured modes)

**NestJS implementation:** `@Injectable()` service injected into `ReservationService` via DI. Configured via `ConfigService` — no constructor args needed at call sites.

**Why in-process:** Single `docker compose up` dev setup. In production this would be a Stripe webhook flow.
