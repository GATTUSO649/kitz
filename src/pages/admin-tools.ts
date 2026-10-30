export class AdminApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
    this.code = code
  }
}

export function isAdminSessionExpired(error: unknown) {
  return error instanceof AdminApiError && (error.status === 401 || error.code === 'UNAUTHENTICATED')
}

export function formatAdminOrderNumber(order: Record<string, unknown>) {
  const currentNumber = String(order.orderNumber ?? '—')
  const legacy = /^KC-(\d{4})-(\d+)$/.exec(currentNumber)
  const existing = /^GSO-(\d+)-(\d{4})$/.exec(currentNumber)
  const orderDate = order.createdAt instanceof Date ? order.createdAt : new Date(String(order.createdAt ?? ''))
  const year = legacy?.[1] ?? existing?.[2] ?? (Number.isNaN(orderDate.getTime()) ? '' : String(orderDate.getUTCFullYear()))
  const rawSequence = legacy?.[2] ?? existing?.[1] ?? order.id
  const sequence = Number(rawSequence)
  if (!year || !Number.isSafeInteger(sequence) || sequence < 1) return currentNumber
  return `GSO-${String(sequence).padStart(4, '0')}-${year}`
}