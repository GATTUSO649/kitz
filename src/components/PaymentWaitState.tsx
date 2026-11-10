import { LoaderCircle } from 'lucide-react'

export function PaymentWaitState({ title = 'Waiting for M-PESA confirmation', message = 'Approve the payment prompt on your phone. We are verifying the transaction securely.' }: { title?: string; message?: string }) {
  return <div className="payment-wait-state" role="status" aria-live="polite">
    <LoaderCircle size={30} aria-hidden="true" />
    <span className="payment-wait-kicker">SECURE PAYMENT</span>
    <strong>{title}</strong>
    <p>{message}</p>
  </div>
}