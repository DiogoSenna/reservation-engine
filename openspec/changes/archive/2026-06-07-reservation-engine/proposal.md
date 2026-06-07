## Why

Concert ticket platforms routinely oversell seats when multiple buyers hit the purchase endpoint simultaneously — a classic race condition that damages user trust and requires costly manual remediation. This project builds a backend that provably prevents overselling under high concurrency, using layered concurrency controls rather than a single naive database lock, while remaining observable and testable end-to-end.

## What Changes

- New backend service built from scratch (no prior codebase)
- REST API for event browsing, ticket purchasing, and ticket management
- JWT-based authentication with admin and user roles
- Atomic Redis inventory gate preventing oversell at the fast path
- Distributed locking (Redlock) serialising the DB write critical section
- Saga-based purchase flow with payment compensation on failure
- Sliding window rate limiting on the purchase endpoint
- Configurable payment mock simulating realistic failure rates
- Prometheus metrics and pre-provisioned Grafana dashboard
- Full test suite: unit (Vitest), integration (Testcontainers), load (k6)
- Docker Compose stack for one-command local setup

## Capabilities

### New Capabilities

- `auth`: JWT login, token validation, role-based access (admin/user)
- `events`: CRUD for concert events with live Redis inventory tracking
- `ticket-purchase`: Layered concurrency purchase flow (Lua DECR → Redlock → Postgres saga)
- `payment-mock`: Configurable in-process payment simulator with failure modes and latency
- `rate-limiting`: Sliding window rate limiter using Redis sorted sets and Lua
- `observability`: Prometheus metrics, Pino structured logging, Grafana dashboard

### Modified Capabilities

*(none — greenfield project)*

## Impact

- **APIs introduced**: `/auth/login`, `/events`, `/events/:id/purchase`, `/tickets/mine`, `/health`, `/metrics`
- **Infrastructure**: PostgreSQL 16, Redis 7, Prometheus, Grafana — all via Docker Compose
- **Dependencies**: NestJS 11, Prisma 7 (with `@prisma/adapter-pg`), ioredis 5, Redlock 4, prom-client 15, zod 4, Vitest 4, Testcontainers 12, k6
- **Notable constraints**: Prisma 7 requires driver adapter pattern; Redlock v4 has no bundled types; Vitest 4 uses OXC transformer (incompatible with unplugin-swc)
