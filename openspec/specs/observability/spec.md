## ADDED Requirements

### Requirement: System exposes a health endpoint
The system SHALL expose `GET /health` that checks Postgres and Redis connectivity and returns their status.

#### Scenario: All services healthy
- **WHEN** Postgres responds to `SELECT 1` and Redis responds to `PING`
- **THEN** the system returns HTTP 200 with `{ status: "ok", postgres: "up", redis: "up" }`

#### Scenario: A dependency is down
- **WHEN** Postgres or Redis does not respond
- **THEN** the affected service is reported as `"down"` in the response body

### Requirement: System exposes Prometheus metrics
The system SHALL expose `GET /metrics` in Prometheus text format, scraped by a Prometheus instance every 5 seconds.

#### Scenario: Metrics endpoint available
- **WHEN** `GET /metrics` is called
- **THEN** the response has `Content-Type: text/plain` and includes all registered metrics in Prometheus exposition format

### Requirement: Purchase outcomes are tracked as counters and histograms
The system SHALL record the following metrics on every purchase attempt:

- `tickets_sold_total` (Counter) — incremented on each confirmed purchase
- `purchase_failed_total` (Counter, label: `reason`) — incremented on each failure with reason: `sold_out`, `payment_failed`, `rate_limited`, `duplicate`, `lock_timeout`
- `purchase_duration_seconds` (Histogram) — full flow duration from start to response
- `payment_mock_duration_seconds` (Histogram) — duration of the payment provider call
- `active_inventory` (Gauge, label: `event_id`) — current Redis inventory count, updated after each confirm
- `redis_lock_acquisitions_total` (Counter) — successful Redlock acquisitions
- `redis_lock_failures_total` (Counter) — Redlock acquisition failures

#### Scenario: Confirmed purchase recorded
- **WHEN** a ticket is confirmed
- **THEN** `tickets_sold_total` is incremented and `active_inventory` is updated for the event

#### Scenario: Failed purchase recorded
- **WHEN** a purchase fails for any reason
- **THEN** `purchase_failed_total` is incremented with the appropriate `reason` label

### Requirement: Each MetricsService instance uses an isolated Registry
The system SHALL instantiate a dedicated `prom-client` Registry per `MetricsService` instance rather than using the global default registry.

#### Scenario: No duplicate metric errors on re-instantiation
- **WHEN** the NestJS module is re-instantiated (hot-reload or test teardown/setup)
- **THEN** no "metric already registered" error is thrown
