# Reservation Engine

A high-concurrency concert ticket reservation backend built with NestJS. Handles race conditions under load using a layered concurrency strategy: atomic Redis operations, distributed locking, and ACID transactions with saga-based payment recovery.

## Architecture

```
k6 Load Test / curl
       │
NestJS API (Fastify adapter, port 3000)
  RateLimitGuard → JwtAuthGuard → Controllers → Services
                                        │
                                ReservationService
                         Lua DECR → Redlock → Prisma saga → PaymentService
                              │                    │
                          Redis 7            PostgreSQL 16
                                                   │
                                        Prometheus → Grafana (port 3001)
```

## Purchase Flow

Each `POST /events/:id/purchase` goes through 7 layers:

1. **RateLimitGuard** — sliding window check via Redis Lua script (10 req/60s per user)
2. **JwtAuthGuard** — validates Bearer token
3. **Lua DECR** — atomically decrements Redis inventory; rejects immediately if sold out
4. **Redlock** — acquires a distributed lock scoped to `user + event`
5. **Duplicate check** — queries for an existing pending/confirmed ticket inside the lock
6. **Postgres txn (hold)** — creates ticket (`pending`) + payment_log (`initiated`) atomically
7. **PaymentService** — simulates Stripe; configurable failure rate
   - On success → Postgres txn confirms ticket + logs payment
   - On failure → saga compensation: ticket cancelled, inventory returned

## Quick Start

```bash
cp .env.example .env
docker compose up postgres redis -d
npm install
npm run migrate:deploy
npm run seed
npm run dev
```

```bash
curl http://localhost:3000/health
# {"status":"ok","postgres":"up","redis":"up"}
```

To run the full stack including Prometheus and Grafana:

```bash
docker compose up -d
```

Grafana: `http://localhost:3001` — admin / admin

## Resetting the Database

After `docker compose down -v` (which wipes all volumes), re-apply migrations and re-seed:

```bash
docker compose up postgres redis -d   # start infra first
npm run migrate:deploy                # re-apply all migrations
npm run seed                          # re-seed users and events
```

Then bring up the rest of the stack as normal.

## Running Tests

```bash
# Unit tests (mocked, fast)
npm test

# Integration test — real Postgres + Redis via Testcontainers
# Proves no oversell under 20 concurrent buyers
npm run test:integration

# Load test — 500 concurrent VUs over 40s
# Requires k6: brew install k6
k6 run tests/load/purchase.k6.js
```

> **Colima users:** export `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock` before running integration tests.

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/login | — | Get JWT token |
| GET | /events | — | List active events with live inventory |
| GET | /events/:id | — | Single event |
| POST | /events | JWT + admin | Create event |
| PUT | /events/:id | JWT + admin | Update event |
| DELETE | /events/:id | JWT + admin | Cancel event |
| POST | /events/:id/purchase | JWT + rate limit | Purchase ticket |
| GET | /tickets/mine | JWT | My confirmed tickets |
| GET | /health | — | Postgres + Redis liveness |
| GET | /metrics | — | Prometheus metrics |

## Seeded Credentials

| Email | Password | Role |
|-------|----------|------|
| admin@example.com | password123 | admin |
| user1–20@example.com | password123 | user |

## Tech Stack

Node.js 20, TypeScript, NestJS 11 (Fastify adapter), Prisma 7, PostgreSQL 16, Redis 7, ioredis 5, Redlock 4, prom-client 15, zod 4, Vitest 4, Testcontainers 12, k6
