import { AsyncLocalStorage } from 'node:async_hooks'

export type MonitoringContext = {
  requestId?: string
  correlationId?: string
  resolveRoute?: () => string
  suppressDatabaseMonitoring?: boolean
}

const monitoringContext = new AsyncLocalStorage<MonitoringContext>()

export function runWithMonitoringContext<T>(context: MonitoringContext, callback: () => T): T {
  return monitoringContext.run(context, callback)
}

export function getMonitoringContext(): MonitoringContext | undefined {
  return monitoringContext.getStore()
}

export function runWithoutDatabaseMonitoring<T>(callback: () => T): T {
  return monitoringContext.run({ ...monitoringContext.getStore(), suppressDatabaseMonitoring: true }, callback)
}