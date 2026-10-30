import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NotificationContext, type NotificationItem, type NotificationKind } from './notification-api'

function NotificationToast({ item, onDismiss }: { item: NotificationItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const lifetime = item.kind === 'error' ? 9000 : item.kind === 'warning' ? 7000 : item.kind === 'pending' ? 6000 : 4500
    const timer = window.setTimeout(() => onDismiss(item.id), lifetime)
    return () => window.clearTimeout(timer)
  }, [item.id, item.kind, onDismiss])

  return <section className={`kit-toast kit-toast-${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'} aria-live={item.kind === 'error' ? 'assertive' : 'polite'}>
    <span className="kit-toast-mark" aria-hidden="true" />
    <p>{item.message}</p>
    <button type="button" aria-label="Dismiss notification" onClick={() => onDismiss(item.id)}>×</button>
  </section>
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([])
  const nextId = useRef(0)
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), [])
  const notify = useCallback((message: string, kind: NotificationKind = 'info') => {
    const normalized = message.trim()
    if (!normalized) return
    setItems((current) => {
      if (current.some((item) => item.message === normalized && item.kind === kind)) return current
      return [...current, { id: ++nextId.current, message: normalized, kind }].slice(-4)
    })
  }, [])
  const contextValue = useMemo(() => ({ notify }), [notify])

  return <NotificationContext.Provider value={contextValue}>
    {children}
    <div className="kit-toast-region" aria-label="Notifications">
      {items.map((item) => <NotificationToast key={item.id} item={item} onDismiss={dismiss} />)}
    </div>
  </NotificationContext.Provider>
}

