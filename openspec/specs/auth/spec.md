## ADDED Requirements

### Requirement: User can authenticate with email and password
The system SHALL accept a POST request to `/auth/login` with `email` and `password` and return a signed JWT token on success.

#### Scenario: Successful login
- **WHEN** a registered user submits valid credentials to `POST /auth/login`
- **THEN** the system returns HTTP 200 with `{ token, user: { id, email, role } }`

#### Scenario: Invalid credentials
- **WHEN** a user submits an unrecognised email or wrong password
- **THEN** the system returns HTTP 401 with `{ message: "Invalid credentials" }`

#### Scenario: Malformed request
- **WHEN** a request is missing `email` or `password`, or `email` is not a valid email format
- **THEN** the system returns HTTP 400 with validation errors

### Requirement: Protected routes require a valid JWT
The system SHALL reject requests to protected endpoints that do not include a valid Bearer token.

#### Scenario: Missing token
- **WHEN** a request to a protected route arrives with no `Authorization` header
- **THEN** the system returns HTTP 401

#### Scenario: Expired or invalid token
- **WHEN** a request includes a malformed or expired JWT
- **THEN** the system returns HTTP 401

### Requirement: Admin-only routes enforce role-based access
The system SHALL reject requests from authenticated non-admin users on routes decorated with `@Roles('admin')`.

#### Scenario: User accesses admin route
- **WHEN** a user with role `user` calls `POST /events`
- **THEN** the system returns HTTP 403

#### Scenario: Admin accesses admin route
- **WHEN** a user with role `admin` calls `POST /events` with a valid payload
- **THEN** the system processes the request normally
