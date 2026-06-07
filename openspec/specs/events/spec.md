## ADDED Requirements

### Requirement: Public users can list active events with live inventory
The system SHALL return all non-cancelled events ordered by date, each including an `availableTickets` field sourced from Redis.

#### Scenario: Events listed with inventory
- **WHEN** anyone calls `GET /events`
- **THEN** the system returns HTTP 200 with an array of events, each including `availableTickets` reflecting current Redis inventory

#### Scenario: Redis key missing on first read
- **WHEN** an event has no Redis inventory key (e.g. after a restart or seed-only setup)
- **THEN** the system initialises the key via `SET NX` from `totalCapacity` and returns the correct count

### Requirement: Admin can create an event
The system SHALL allow admin users to create events, which initialises a Redis inventory key set to `totalCapacity`.

#### Scenario: Successful creation
- **WHEN** an admin submits a valid `POST /events` payload
- **THEN** the system returns HTTP 201 with the created event and sets `event:{id}:inventory` in Redis to `totalCapacity`

#### Scenario: Unauthorised creation attempt
- **WHEN** a non-admin user calls `POST /events`
- **THEN** the system returns HTTP 403

### Requirement: Admin can update an event
The system SHALL allow admin users to update mutable event fields. Cancelled events MUST NOT be updated.

#### Scenario: Successful update
- **WHEN** an admin calls `PUT /events/:id` with a valid partial payload on an active event
- **THEN** the system returns HTTP 200 with updated event data

#### Scenario: Update of cancelled event
- **WHEN** an admin calls `PUT /events/:id` on a cancelled event
- **THEN** the system returns HTTP 409

### Requirement: Admin can cancel an event
The system SHALL allow admin users to cancel an event, which cancels all pending tickets and removes the Redis inventory key.

#### Scenario: Successful cancellation
- **WHEN** an admin calls `DELETE /events/:id`
- **THEN** the system sets the event status to `cancelled`, cancels all `pending` tickets for that event, and deletes the Redis inventory key
