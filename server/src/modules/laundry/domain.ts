export type LaundryBookingStatus =
  | 'new'
  | 'confirmed'
  | 'pickup_scheduled'
  | 'collected'
  | 'washing'
  | 'drying'
  | 'ironing_folding'
  | 'ready_for_delivery'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled'

export type LaundryPaymentStatus = 'PAID' | 'UNPAID' | 'PENDING'

export function moneyToCents(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : NaN
}

export function centsToMoney(value: number): string {
  return (value / 100).toFixed(2)
}

export function laundryPaymentStatus(input: {
  amountDueCents: number
  amountPaidCents: number
  pendingPayments: number
}): LaundryPaymentStatus {
  if (input.pendingPayments > 0) return 'PENDING'
  if (input.amountDueCents > 0 && input.amountPaidCents >= input.amountDueCents) return 'PAID'
  if (input.amountPaidCents > 0) return 'PENDING'
  return 'UNPAID'
}

export function wouldOverpay(amountDueCents: number, confirmedPaidCents: number, addedPaymentCents: number): boolean {
  return addedPaymentCents > 0 && confirmedPaidCents + addedPaymentCents > amountDueCents
}

const nextLaundryStatuses: Record<LaundryBookingStatus, readonly LaundryBookingStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['pickup_scheduled', 'cancelled'],
  pickup_scheduled: ['collected', 'cancelled'],
  collected: ['washing'],
  washing: ['drying'],
  drying: ['ironing_folding'],
  ironing_folding: ['ready_for_delivery'],
  ready_for_delivery: ['out_for_delivery'],
  out_for_delivery: ['completed'],
  completed: [],
  cancelled: [],
}

export function canTransitionLaundryStatus(from: LaundryBookingStatus, to: LaundryBookingStatus): boolean {
  return nextLaundryStatuses[from].includes(to)
}