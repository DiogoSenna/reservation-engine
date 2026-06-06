# Rate Limiting Spec

**Algorithm:** Sliding window log (Redis sorted set)

**Keys:**
- `ratelimit:{userId}` — authenticated users (10 requests / 60s)
- `ratelimit:ip:{ip}` — unauthenticated (30 requests / 60s)

**Flow:**
1. Prune entries older than the window cutoff via `ZREMRANGEBYSCORE`
2. Count remaining entries via `ZCARD`
3. If count >= limit: return 0 (denied)
4. Add current request with `ZADD` (score = timestamp ms)
5. Set key TTL to window size via `PEXPIRE`
6. Return 1 (allowed)

All 6 steps execute atomically in a single Lua script call.

**NestJS implementation:** `RateLimitGuard` implements `CanActivate` — applied with `@UseGuards(JwtAuthGuard, RateLimitGuard)` on the purchase route. The guard checks the JWT user if present, falls back to IP.

**Response on limit exceeded:** `429 Too Many Requests` with `Retry-After` header.
