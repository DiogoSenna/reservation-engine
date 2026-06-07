## ADDED Requirements

### Requirement: Purchase atomically gates on Redis inventory
The system SHALL decrement a Redis counter atomically via Lua before any database write. If the counter is already zero, the request MUST be rejected as `sold_out` without opening a database connection.

#### Scenario: Inventory available
- **WHEN** `POST /events/:id/purchase` is called and Redis inventory is > 0
- **THEN** the counter is decremented and the request proceeds to the lock phase

#### Scenario: Inventory exhausted
- **WHEN** `POST /events/:id/purchase` is called and Redis inventory is 0
- **THEN** the system returns HTTP 409 `{ error: "sold_out" }` without touching the database

### Requirement: Purchase acquires a distributed lock before writing
The system SHALL acquire a Redlock lock scoped to `user + event` before creating any database records. If the lock cannot be acquired after retries, the request MUST return `lock_timeout` and the inventory slot MUST be returned.

#### Scenario: Lock acquired
- **WHEN** the lock on `lock:purchase:{userId}:{eventId}` is available
- **THEN** the system proceeds to the duplicate check and database phase

#### Scenario: Lock timeout
- **WHEN** the lock cannot be acquired within the retry budget
- **THEN** the system increments the Redis inventory counter and returns HTTP 409 `{ error: "lock_timeout" }`

### Requirement: Purchase prevents duplicate tickets
The system SHALL check for an existing `pending` or `confirmed` ticket for the same user and event inside the lock. If one exists, the inventory slot MUST be returned.

#### Scenario: Duplicate detected
- **WHEN** the user already has a `pending` or `confirmed` ticket for the event
- **THEN** the system increments the Redis inventory counter and returns HTTP 409 `{ error: "duplicate" }`

### Requirement: Purchase executes a two-phase saga
The system SHALL create the ticket and payment_log in Phase 1, call the payment provider outside any transaction, then confirm or compensate in Phase 2.

#### Scenario: Successful purchase
- **WHEN** Phase 1 creates the pending ticket and payment succeeds
- **THEN** Phase 2 updates the ticket to `confirmed`, payment_log to `success`, and returns HTTP 201 with `{ ticket, paymentLog }`

#### Scenario: Payment failure — saga compensation
- **WHEN** Phase 1 succeeds but the payment provider returns failure
- **THEN** the ticket is set to `cancelled`, payment_log to `failed`, Redis inventory is incremented, and the system returns HTTP 402 `{ error: "payment_failed" }`

### Requirement: User can view their confirmed tickets
The system SHALL return all `confirmed` tickets for the authenticated user, including event details.

#### Scenario: Tickets listed
- **WHEN** an authenticated user calls `GET /tickets/mine`
- **THEN** the system returns HTTP 200 with an array of confirmed tickets ordered by `purchasedAt` descending, each including the associated event
