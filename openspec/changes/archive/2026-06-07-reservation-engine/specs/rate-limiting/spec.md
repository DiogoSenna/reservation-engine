## ADDED Requirements

### Requirement: Purchase endpoint enforces a sliding window rate limit
The system SHALL limit purchase attempts to 10 requests per 60-second sliding window per authenticated user. All 6 steps of the algorithm (prune, count, gate, add, expire, return) MUST execute atomically in a single Lua script call.

#### Scenario: Within limit
- **WHEN** an authenticated user makes fewer than 10 purchase attempts within 60 seconds
- **THEN** all requests are allowed through to the purchase flow

#### Scenario: Limit exceeded
- **WHEN** an authenticated user makes more than 10 purchase attempts within 60 seconds
- **THEN** the system returns HTTP 429 with a `Retry-After` header indicating seconds until the window clears

### Requirement: Unauthenticated requests are rate-limited by IP
The system SHALL fall back to an IP-based rate limit key when no authenticated user is present.

#### Scenario: IP-based limiting
- **WHEN** a request arrives without a valid JWT
- **THEN** the rate limit key is `ratelimit:ip:{ip}` instead of `ratelimit:{userId}`

### Requirement: Rate limit keys expire automatically
The system SHALL set a TTL on rate limit keys equal to the window duration, so keys are cleaned up when a user goes idle.

#### Scenario: Key expiry
- **WHEN** no requests are made for longer than the window duration
- **THEN** the Redis sorted set key expires and is removed automatically
