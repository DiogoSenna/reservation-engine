# Data Model Spec

## Key Decisions

- **No wallet_balance** — money lives at the payment provider.
- **card_token** — mock Stripe customer ID. In production: Stripe `cus_` ID.
- **expires_at on tickets** — models real-world "ticket held for 10 minutes" UX. NULL once confirmed.
- **idempotency_key on tickets** — UNIQUE constraint prevents duplicate purchases on client retries.
- **payment_logs** — append-only audit trail of saga phases (initiated → success/failed).
- **events.status soft-delete** — cancelled events keep ticket history intact.

## Postgres Schema

```
users            events
──────────────   ──────────────────────
id (uuid PK)     id (uuid PK)
email (unique)   name
password_hash    venue
card_token       event_date
role             total_capacity
created_at       price
                 status (active|cancelled|sold_out)
                 created_at

tickets                      payment_logs
────────────────────────     ────────────────────────
id (uuid PK)                 id (uuid PK)
user_id → users              ticket_id → tickets
event_id → events            user_id → users
status                       event_id → events
  (pending|confirmed|        amount
   cancelled)                status
expires_at (null when          (initiated|success|
  confirmed)                    failed|refunded)
idempotency_key (unique)     failure_reason
purchased_at                 provider_ref
                             created_at
```

## Redis Keys

| Key | Type | Set by | Purpose |
|---|---|---|---|
| `event:{id}:inventory` | String (integer) | `EventsService.create()` / lazy init on first GET | Fast inventory gate for Lua DECR |
| `lock:purchase:{userId}:{eventId}` | Redlock | `ReservationService` | Serialize the DB write critical section |
| `ratelimit:{userId}` | Sorted set | `RateLimitService` | Sliding window log per authenticated user |
| `ratelimit:ip:{ip}` | Sorted set | `RateLimitService` | Sliding window log per anonymous IP |

**Redis is the fast gate; Postgres is authoritative.** If Redis inventory diverges (e.g. Redis restart), the lazy `SET NX` in `EventsService.withInventory()` re-initialises from `totalCapacity`. Confirmed ticket count in Postgres is the ground truth.
