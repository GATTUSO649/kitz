import { createContext, useContext } from 'react'

export type NotificationKind = 'success' | 'error' | 'warning' | 'info' | 'pending'
export type NotificationItem = { id: number; message: string; kind: NotificationKind }
export type NotificationContextValue = { notify: (message: string, kind?: NotificationKind) => void }

export const NotificationContext = createContext<NotificationContextValue | null>(null)

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifications must be used within NotificationProvider.')
  return context
}

export function userFacingErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError) return 'We couldn\'t connect to the server. Please check your connection and try again.'
  return error instanceof Error ? error.message : fallback
}