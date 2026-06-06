# Observability Spec

## Metrics (Prometheus via MetricsService)

| Metric | Type | Labels | Description |
|---|---|---|---|
| `tickets_sold_total` | Counter | — | Confirmed purchases |
| `purchase_failed_total` | Counter | `reason` | sold_out, payment_failed, rate_limited, duplicate, lock_timeout |
| `purchase_duration_seconds` | Histogram | — | Full flow latency (Lua DECR → DB confirm) |
| `payment_mock_duration_seconds` | Histogram | — | Simulated external payment call latency |
| `active_inventory` | Gauge | `event_id` | Current Redis counter per event (updated after each confirm) |
| `redis_lock_acquisitions_total` | Counter | — | Successful Redlock acquires |
| `redis_lock_failures_total` | Counter | — | Redlock timeout/failures |

Each `MetricsService` instance uses its own `Registry` (not the global prom-client default) to prevent duplicate metric registration errors on NestJS hot-reload or test re-instantiation.

## Endpoints

- `GET /health` — liveness + readiness: pings Postgres (`SELECT 1`) and Redis (`PING`) concurrently, returns `{ status, postgres, redis }`
- `GET /metrics` — Prometheus text format, scraped by Prometheus every 5s

## Logging

NestJS + Fastify adapter uses Pino by default via `FastifyAdapter({ logger: true })`. Every HTTP request logs `method`, `url`, `statusCode`, `responseTime` as structured JSON.

## Grafana Dashboard

Pre-provisioned at `infra/grafana/dashboards/reservation.json`. Four panels:

| Panel | Type | Query |
|---|---|---|
| Tickets Sold | Stat | `tickets_sold_total` |
| Purchase Failures by Reason | Timeseries | `rate(purchase_failed_total[1m])` by `reason` |
| Purchase Latency p95 | Timeseries | `histogram_quantile(0.95, rate(purchase_duration_seconds_bucket[1m]))` |
| Active Inventory | Timeseries | `active_inventory` by `event_id` |

## Local Stack

```
App (port 3000) ──scrape /metrics──► Prometheus (port 9090)
                                              │
                                              ▼
                                     Grafana (port 3001)
                                     admin / admin
```

Start full stack: `docker compose up -d`
