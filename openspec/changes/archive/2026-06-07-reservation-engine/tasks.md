## 1. Project Scaffolding

- [x] 1.1 Initialise Node.js project with TypeScript, NestJS 11, and all dependencies
- [x] 1.2 Configure tsconfig.json (emitDecoratorMetadata, strictNullChecks, commonjs)
- [x] 1.3 Configure nest-cli.json and vitest.config.ts
- [x] 1.4 Create .env.example with all required environment variables
- [x] 1.5 Create shared types in types/index.ts (JwtPayload, PurchaseOutcome, enums)
- [x] 1.6 Create zod-validated configuration factory in src/config/configuration.ts

## 2. Infrastructure

- [x] 2.1 Create docker-compose.yml with postgres, redis, app, prometheus, grafana services
- [x] 2.2 Create Dockerfile with multi-stage build
- [x] 2.3 Create Prometheus scrape config at infra/prometheus/prometheus.yml
- [x] 2.4 Create Grafana datasource and dashboard provisioning files
- [x] 2.5 Create pre-provisioned Grafana dashboard JSON with 4 panels

## 3. Database

- [x] 3.1 Define Prisma schema (User, Event, Ticket, PaymentLog with all enums)
- [x] 3.2 Run initial migration
- [x] 3.3 Create seed script (1 admin + 20 users + 2 events)

## 4. Global Infrastructure Modules

- [x] 4.1 Create PrismaService extending PrismaClient with pg.Pool + adapter pattern
- [x] 4.2 Create PrismaModule (@Global)
- [x] 4.3 Embed Lua scripts as TypeScript constants in src/redis/scripts/index.ts
- [x] 4.4 Create RedisService extending ioredis Redis (constructor param named configService)
- [x] 4.5 Create RedlockService with custom type declaration for redlock v4
- [x] 4.6 Create RedisModule (@Global)
- [x] 4.7 Create MetricsService with own Registry instance and all counters/histograms/gauges
- [x] 4.8 Create MetricsModule (@Global)

## 5. App Bootstrap & Health

- [x] 5.1 Create HealthController (GET /health, GET /metrics)
- [x] 5.2 Create HealthModule
- [x] 5.3 Create AppModule with all global modules registered
- [x] 5.4 Create main.ts with NestFactory + FastifyAdapter + ValidationPipe

## 6. Auth Module

- [x] 6.1 Write failing unit tests for AuthService
- [x] 6.2 Create LoginDto with email and password validation
- [x] 6.3 Create AuthService (validateUser + login with bcrypt)
- [x] 6.4 Create JwtStrategy (PassportStrategy, extracts from Bearer header)
- [x] 6.5 Create JwtAuthGuard extending AuthGuard('jwt')
- [x] 6.6 Create RolesGuard reading ROLES_KEY metadata via Reflector
- [x] 6.7 Create @Roles decorator and @CurrentUser param decorator
- [x] 6.8 Create AuthController (POST /auth/login)
- [x] 6.9 Create AuthModule and register in AppModule

## 7. Events Module

- [x] 7.1 Create CreateEventDto and UpdateEventDto (PartialType)
- [x] 7.2 Create EventsService (findAll, findOne, create, update, cancel) with lazy Redis SET NX
- [x] 7.3 Create EventsController (GET /events, GET /events/:id, POST, PUT, DELETE)
- [x] 7.4 Create EventsModule and register in AppModule

## 8. Rate Limiting Module

- [x] 8.1 Write failing unit tests for RateLimitService
- [x] 8.2 Create RateLimitService (sliding window check via Lua eval)
- [x] 8.3 Create RateLimitGuard (CanActivate, sets Retry-After header on 429)
- [x] 8.4 Create RateLimitModule

## 9. Payment Module

- [x] 9.1 Write failing unit tests for PaymentService
- [x] 9.2 Create PaymentService (configurable success rate, failure modes, latency)
- [x] 9.3 Create PaymentModule

## 10. Reservation Module

- [x] 10.1 Write failing unit tests for ReservationService (sold_out, duplicate, payment compensation)
- [x] 10.2 Create ReservationService (Lua DECR → Redlock → Prisma saga)
- [x] 10.3 Create ReservationModule importing PaymentModule

## 11. Purchase Route & Tickets Module

- [x] 11.1 Add POST /events/:id/purchase to EventsController with JwtAuthGuard + RateLimitGuard
- [x] 11.2 Update EventsModule to import ReservationModule and RateLimitModule
- [x] 11.3 Create TicketsService (findMine)
- [x] 11.4 Create TicketsController (GET /tickets/mine)
- [x] 11.5 Create TicketsModule and register in AppModule

## 12. Integration Test

- [x] 12.1 Create tests/integration/purchase.spec.ts using Testcontainers
- [x] 12.2 Assert exactly totalCapacity confirmed tickets and zero oversells across 20 concurrent buyers
- [x] 12.3 Configure test:integration npm script with TESTCONTAINERS_RYUK_DISABLED=true

## 13. Load Test

- [x] 13.1 Create tests/load/purchase.k6.js with ramp to 500 VUs over 40s
- [x] 13.2 Define thresholds: checks (not 5xx) === 100%, p95 < 2s
- [x] 13.3 Track confirmed, sold_out, payment_failed, rate_limited as custom counters

## 14. Documentation

- [x] 14.1 Create openspec/specs/ for each capability (reservation-flow, rate-limiting, payment-mock, data-model, observability)
- [x] 14.2 Create README.md with architecture diagram, quick start, API reference
- [x] 14.3 Create CLAUDE.md with tech stack, commands, and architectural gotchas
