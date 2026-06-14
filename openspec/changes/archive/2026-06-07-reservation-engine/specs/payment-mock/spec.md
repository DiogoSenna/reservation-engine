## ADDED Requirements

### Requirement: Payment mock simulates configurable success and failure rates
The system SHALL use environment variables to control the probability of payment success and the failure modes returned on failure.

#### Scenario: Successful charge
- **WHEN** `PAYMENT_SUCCESS_RATE=1` and `PaymentService.charge()` is called
- **THEN** the service returns `{ success: true, providerRef: "mock_{idempotencyKey}", failureReason: null }`

#### Scenario: Failed charge
- **WHEN** `PAYMENT_SUCCESS_RATE=0` and `PAYMENT_FAILURE_MODES=card_declined` and `PaymentService.charge()` is called
- **THEN** the service returns `{ success: false, providerRef: null, failureReason: "card_declined" }`

### Requirement: Payment mock simulates realistic latency
The system SHALL introduce a random delay between `PAYMENT_MIN_LATENCY_MS` and `PAYMENT_MAX_LATENCY_MS` on every charge call.

#### Scenario: Latency applied
- **WHEN** `PAYMENT_MIN_LATENCY_MS=50` and `PAYMENT_MAX_LATENCY_MS=300`
- **THEN** each `charge()` call completes between 50ms and 300ms after invocation

#### Scenario: Zero latency for tests
- **WHEN** `PAYMENT_MIN_LATENCY_MS=0` and `PAYMENT_MAX_LATENCY_MS=0`
- **THEN** `charge()` completes without artificial delay, making tests fast
