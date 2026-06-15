import type { PaymentFailureReason } from '../types'

export interface ChargeOptions {
  cardToken: string
  amount: number
  idempotencyKey: string
}

export interface ChargeResult {
  success: boolean
  providerRef: string | null
  failureReason: PaymentFailureReason | null
}

export abstract class PaymentService {
  abstract charge(options: ChargeOptions): Promise<ChargeResult>
}
