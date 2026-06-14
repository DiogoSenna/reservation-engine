export type UserRole = 'user' | 'admin'
export type EventStatus = 'active' | 'cancelled' | 'sold_out'
export type TicketStatus = 'pending' | 'confirmed' | 'cancelled'
export type PaymentStatus = 'initiated' | 'success' | 'failed' | 'refunded'
export type PaymentFailureReason = 'card_declined' | 'timeout' | 'fraud'

export interface JwtPayload {
  sub: string
  email: string
  role: UserRole
}

export interface PurchaseResult {
  ticket: { id: string; status: TicketStatus; expiresAt: Date | null }
  paymentLog: { id: string; status: PaymentStatus; providerRef: string | null }
}

export type PurchaseOutcome =
  | PurchaseResult
  | { error: 'sold_out' }
  | { error: 'duplicate' }
  | { error: 'lock_timeout' }
  | { error: 'payment_failed'; reason: string | null }
