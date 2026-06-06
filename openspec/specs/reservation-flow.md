# Reservation Flow Spec

**Approach:** Layered concurrency (Redis fast gate → Redlock critical section → Postgres ACID saga)

## Steps

1. **[Lua DECR]** Atomically decrement `event:{eventId}:inventory`. If < 0, roll back and return `sold_out`.
2. **[Redlock]** Acquire `lock:purchase:{userId}:{eventId}` (TTL 10s). On failure, return inventory and return `lock_timeout`.
3. **[Duplicate check]** Inside lock: query for existing pending/confirmed ticket. If found, return inventory and return `duplicate`.
4. **[Postgres interactive txn — Phase 1]** Create ticket (pending) + payment_log (initiated) atomically.
5. **[PaymentService.charge()]** External call — intentionally outside any DB transaction.
6a. **[Postgres txn — Phase 2 Confirm]** ticket → confirmed, payment_log → success.
6b. **[Saga compensation]** ticket → cancelled, payment_log → failed, Redis INCR inventory.
7. **[Redlock release]** Always in `finally`.

## Failure Matrix

| Failure point | Inventory | Ticket | Compensated? |
|---|---|---|---|
| Lua returns 0 | unchanged | not created | N/A |
| Redlock timeout | INCR'd back | not created | yes |
| Duplicate | INCR'd back | not created | yes |
| Phase 1 DB fails | INCR'd back (catch) | not created | yes |
| Payment fails | INCR'd back | cancelled | yes |
| Phase 2 DB fails | NOT returned | stuck pending | manual reconciliation needed |

## NestJS notes

`ReservationService` is `@Injectable()`. All dependencies (PrismaService, RedisService, RedlockService, PaymentService, MetricsService) are injected via constructor — no singletons. This makes unit testing straightforward: `Test.createTestingModule()` with mocked providers.
