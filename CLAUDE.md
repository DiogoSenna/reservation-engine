# Reservation Engine — Claude Context

## Tech Stack

- Node.js 20, TypeScript, NestJS 11 (Fastify adapter)
- Prisma 7 + PostgreSQL 16 — uses `prisma-client-js` generator + `@prisma/adapter-pg` driver adapter
- ioredis 5 + Redlock 4
- prom-client 15 (own Registry instance per service — never the global default)
- zod 4 for config validation (`src/config/configuration.ts`)
- class-validator + class-transformer for DTO validation
- Vitest 4 + @nestjs/testing + Testcontainers 12
- k6 for load testing

## Key Commands

```bash
npm run dev              # start with hot reload
npm run migrate          # create and apply migration (dev)
npm run migrate:deploy   # apply existing migrations (prod/CI)
npm run seed             # seed users and events
npm test                 # unit tests
npm run test:integration # integration tests (needs Docker + DOCKER_HOST on Colima)
npm run build            # compile to dist/
docker compose up -d     # start full stack (postgres, redis, app, prometheus, grafana)
```

## NestJS Module Structure

- `PrismaModule`, `RedisModule`, `MetricsModule` are `@Global()` — available everywhere via DI without re-importing
- `ConfigModule` is global via `isGlobal: true`
- Feature modules: `AuthModule`, `EventsModule`, `ReservationModule`, `TicketsModule`, `RateLimitModule`, `PaymentModule`, `HealthModule`

## Architecture Patterns

**ReservationService** (`src/reservation/reservation.service.ts`) owns all purchase logic. Controllers validate input and delegate — never add business logic to controllers.

**Guards chain on purchase route:** `@UseGuards(JwtAuthGuard, RateLimitGuard)` — JWT runs first, then rate limit uses the authenticated user ID as the key.

**Lua scripts** live in `src/redis/scripts/index.ts` as TypeScript string constants. Do not move them to `.lua` files — nest-cli does not copy non-TS assets to `dist/` reliably without explicit config.

**Prisma 7 driver adapter pattern:** All `PrismaClient` instances must be constructed with `{ adapter: new PrismaPg(pool) }`. The schema datasource block has no `url` field — URL is provided via `prisma.config.ts` for CLI commands and via the adapter for runtime.

**RedisService constructor param** must NOT be named `config` — ioredis exposes a public `.config()` method on the Redis class, causing a TypeScript conflict. It is named `configService`.

**MetricsService** uses its own `Registry` instance to avoid duplicate metric registration errors during tests or hot-reload.

**Saga compensation:** If payment fails after Phase 1 hold, the ticket is cancelled and Redis inventory is INCR'd back. Phase 2 failures (after payment succeeds but before DB confirm) leave the ticket in `pending` — documented known gap in `openspec/specs/reservation-flow.md`.

**Lazy Redis inventory init:** `EventsService.withInventory()` calls `SET NX` on the inventory key so seeded events (which bypass `EventsService.create()`) are correctly initialised on first read.

## Testing

- Unit tests use `Test.createTestingModule()` with mocked providers — no real DB or Redis
- Integration tests use Testcontainers: real Postgres 16 + Redis 7, real migrations, real seed
- Never mock in integration tests
- `TESTCONTAINERS_RYUK_DISABLED=true` is set in `test:integration` script for Colima compatibility
- Colima users must also export `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`
- Vitest 4 uses OXC transformer by default — `unplugin-swc` is NOT used (incompatible with Vitest 4)

## Specs

All design decisions are documented in `openspec/specs/`:
- `reservation-flow.md` — the 7-step purchase flow and failure matrix
- `rate-limiting.md` — sliding window algorithm
- `payment-mock.md` — configurable PaymentService behaviour
- `data-model.md` — Postgres schema + Redis key inventory
- `observability.md` — metrics catalogue + Grafana dashboard
