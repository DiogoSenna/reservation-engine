import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MetricsService } from '../metrics/metrics.service'
import type { AppConfig } from '../config/configuration'
import type { PaymentFailureReason } from '../types'

interface ChargeOptions {
  cardToken: string
  amount: number
  idempotencyKey: string
}

interface ChargeResult {
  success: boolean
  providerRef: string | null
  failureReason: PaymentFailureReason | null
}

@Injectable()
export class PaymentService {
  private readonly successRate: number
  private readonly failureModes: PaymentFailureReason[]
  private readonly minLatencyMs: number
  private readonly maxLatencyMs: number

  constructor(
    config: ConfigService<AppConfig>,
    private readonly metrics: MetricsService,
  ) {
    this.successRate = config.get('PAYMENT_SUCCESS_RATE', { infer: true })!
    this.failureModes = (config.get('PAYMENT_FAILURE_MODES', { infer: true })! as string)
      .split(',') as PaymentFailureReason[]
    this.minLatencyMs = config.get('PAYMENT_MIN_LATENCY_MS', { infer: true })!
    this.maxLatencyMs = config.get('PAYMENT_MAX_LATENCY_MS', { infer: true })!
  }

  async charge({ idempotencyKey }: ChargeOptions): Promise<ChargeResult> {
    const end = this.metrics.paymentDurationSeconds.startTimer({ provider: 'mock' })
    const latency = this.minLatencyMs + Math.random() * (this.maxLatencyMs - this.minLatencyMs)
    await new Promise((r) => setTimeout(r, latency))
    end()

    if (Math.random() < this.successRate) {
      return { success: true, providerRef: `mock_${idempotencyKey}`, failureReason: null }
    }

    const reason = this.failureModes[Math.floor(Math.random() * this.failureModes.length)] ?? 'card_declined'
    return { success: false, providerRef: null, failureReason: reason }
  }
}
