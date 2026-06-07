## Context

Greenfield NestJS backend for concert ticket reservations. The core engineering challenge is the oversell race condition: under concurrent load, multiple buyers can observe remaining inventory simultaneously and all proceed to purchase, resulting in more confirmed tickets than seats available. The solution must be correct under real concurrency (not just in tests with mocked infrastructure), observable in production, and demonstrable via automated tests.

## Goals / Non-Goals

**Goals:**
- Zero oversells under concurrent load — proven by an integration test with real Redis and Postgres
- Sub-10ms p95 latency for the rejection path (sold-out requests)
- Observable purchase outcomes via Prometheus metrics (sold_out, payment_failed, rate_limited, duplicate, lock_timeout)
- Full local stack with a single `docker compose up`
- Test coverage at three levels: unit (logic), integration (concurrency correctness), load (degradation under stress)

**Non-Goals:**
- Real payment processing (Stripe integration)
- Ticket transfer, refunds, or waitlists
- Frontend or mobile client
- Multi-region or multi-node Redis (single Redis node for this demo)
- Persistent Prometheus/Grafana data across restarts

## Decisions

### 1. Layered concurrency over a single database lock

**Decision:** Use three layers — Redis Lua DECR → Redlock → Postgres `$transaction` — rather than a single `SELECT FOR UPDATE`.

**Rationale:** `SELECT FOR UPDATE` holds a row lock for the full transaction duration, including the external payment call (50–300ms). At high concurrency this serialises all purchases at the database, exhausting the connection pool. The Redis DECR gate rejects sold-out requests atomically in <1ms without touching the database. Only requests with a realistic chance of succeeding open a DB connection.

**Alternatives considered:**
- `SELECT FOR UPDATE` — correct but poor throughput under load
- Optimistic locking with retry — difficult to bound retry storms at high concurrency
- Single Redis atomic counter only — no durable record; no saga possible

### 2. Saga pattern over distributed transaction for payment

**Decision:** Split the purchase into Phase 1 (hold: create pending ticket + payment_log), external payment call, then Phase 2 (confirm or compensate), each as independent local transactions.

**Rationale:** External HTTP calls must never run inside a database transaction — the connection is held open for the network round-trip, starving the pool. The saga pattern allows each phase to commit independently; compensation logic (cancel ticket, return inventory) handles failures.

**Known gap:** If Phase 2 (DB confirm after successful payment) fails, the user is charged but their ticket stays `pending`. Production mitigation: a reconciliation job that periodically resolves stale `pending` tickets by cross-referencing payment_log status.

**Alternatives considered:**
- Two-phase commit — requires all participants to support it; payment providers don't
- Outbox pattern — adds more infrastructure complexity than warranted for this scope

### 3. NestJS with Fastify adapter over Express

**Decision:** `@nestjs/platform-fastify` instead of the default Express adapter.

**Rationale:** Fastify has measurably lower per-request overhead and native Pino structured logging. NestJS's module/DI system provides the architectural structure needed for testability — constructor injection makes every service swappable with a mock in unit tests.

### 4. Prisma 7 with driver adapter pattern

**Decision:** Use `prisma-client-js` generator + `@prisma/adapter-pg` + `pg.Pool` rather than the new `prisma-client` generator.

**Rationale:** Prisma 7 introduced a new `prisma-client` generator that outputs TypeScript source files and requires the driver adapter at construction time with no `url` in the schema. The `prisma-client-js` generator is backward-compatible and widely understood. The adapter pattern (`new PrismaClient({ adapter: new PrismaPg(pool) })`) is applied consistently across `PrismaService` and `scripts/seed.ts`.

### 5. Lua scripts as TypeScript string constants

**Decision:** Embed Redis Lua scripts as exported string constants in `src/redis/scripts/index.ts` rather than `.lua` files.

**Rationale:** NestJS's `nest build` only compiles `.ts` files. Copying `.lua` files to `dist/` requires explicit `assets` configuration in `nest-cli.json` and is fragile across environments. Embedding as strings is simpler, version-controlled alongside the code that uses them, and has no runtime file I/O.

### 6. Own Prometheus Registry per MetricsService instance

**Decision:** Pass a `new Registry()` instance to each metric constructor rather than using prom-client's global default registry.

**Rationale:** prom-client's global registry throws "metric already registered" errors when NestJS hot-reloads or when tests re-instantiate the module. An instance-scoped registry is isolated and idempotent.

## Risks / Trade-offs

- **Single Redis node** → No Redlock majority quorum; lock correctness depends on one node. Acceptable for demo; production would require 3+ independent Redis nodes. → *Mitigation: documented in CLAUDE.md*
- **Phase 2 saga gap** → Successful payment + failed DB confirm leaves ticket in `pending`. → *Mitigation: documented in reservation-flow.md; reconciliation job is the production fix*
- **Lazy Redis inventory init** → After a Redis restart, `SET NX` re-seeds from `totalCapacity`, potentially ignoring already-sold tickets until Postgres is consulted. → *Mitigation: acceptable for demo; production would seed from DB on startup*
- **Rate limit shared tokens in load test** → 20 users × 10 req/60s = 200 purchase attempts before rate limiting; load test shows mostly 429s. → *Mitigation: expected and documented; demonstrates the guard working correctly*
- **Colima Docker socket** → Testcontainers requires `DOCKER_HOST` env var on Colima setups (non-standard socket path). → *Mitigation: documented in README and CLAUDE.md; `TESTCONTAINERS_RYUK_DISABLED=true` in npm script*

## Open Questions

*(none — all decisions resolved during implementation)*
