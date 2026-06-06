import { Injectable } from '@nestjs/common'
import {
  Counter, Histogram, Gauge,
  collectDefaultMetrics, Registry,
} from 'prom-client'

@Injectable()
export class MetricsService {
  readonly register: Registry
  readonly ticketsSoldTotal: Counter
  readonly purchaseFailedTotal: Counter<'reason'>
  readonly purchaseDurationSeconds: Histogram
  readonly paymentMockDurationSeconds: Histogram
  readonly activeInventory: Gauge<'event_id'>
  readonly redisLockAcquisitionsTotal: Counter
  readonly redisLockFailuresTotal: Counter

  constructor() {
    this.register = new Registry()
    collectDefaultMetrics({ register: this.register })

    this.ticketsSoldTotal = new Counter({
      name: 'tickets_sold_total',
      help: 'Total confirmed purchases',
      registers: [this.register],
    })
    this.purchaseFailedTotal = new Counter({
      name: 'purchase_failed_total',
      help: 'Failed purchase attempts',
      labelNames: ['reason'],
      registers: [this.register],
    })
    this.purchaseDurationSeconds = new Histogram({
      name: 'purchase_duration_seconds',
      help: 'Full purchase flow duration',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.register],
    })
    this.paymentMockDurationSeconds = new Histogram({
      name: 'payment_mock_duration_seconds',
      help: 'Payment mock call duration',
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.register],
    })
    this.activeInventory = new Gauge({
      name: 'active_inventory',
      help: 'Current Redis inventory per event',
      labelNames: ['event_id'],
      registers: [this.register],
    })
    this.redisLockAcquisitionsTotal = new Counter({
      name: 'redis_lock_acquisitions_total',
      help: 'Redlock acquisitions',
      registers: [this.register],
    })
    this.redisLockFailuresTotal = new Counter({
      name: 'redis_lock_failures_total',
      help: 'Redlock acquisition failures',
      registers: [this.register],
    })
  }
}
