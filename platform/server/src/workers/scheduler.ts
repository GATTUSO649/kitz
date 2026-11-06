import { markWorkerFailed, markWorkerStarted, markWorkerSucceeded, safeWorkerError, scheduleWorkerNextRun, setWorkerEnabled, type WorkerName } from './health.js'

export type WorkerSchedule = { intervalMs: number; maximumBackoffMs: number }

export function workerRetryDelay(intervalMs: number, consecutiveFailures: number, maximumBackoffMs: number): number {
  const exponent = Math.max(0, Math.min(30, consecutiveFailures - 1))
  return Math.min(maximumBackoffMs, intervalMs * (2 ** exponent))
}

export function startScheduledWorker(
  worker: WorkerName,
  schedule: WorkerSchedule,
  run: () => Promise<number>,
  enabled = true,
): () => void {
  setWorkerEnabled(worker, enabled)
  if (!enabled) return () => undefined

  let stopped = false
  let running = false
  let consecutiveFailures = 0
  let timer: NodeJS.Timeout | undefined

  const scheduleNext = (delayMs: number) => {
    if (stopped) return
    const nextRunAt = new Date(Date.now() + delayMs)
    scheduleWorkerNextRun(worker, nextRunAt)
    timer = setTimeout(() => { void execute() }, delayMs)
    timer.unref()
  }

  const execute = async () => {
    if (stopped || running) return
    running = true
    markWorkerStarted(worker)
    try {
      const processedCount = await run()
      consecutiveFailures = 0
      markWorkerSucceeded(worker, processedCount)
      scheduleNext(schedule.intervalMs)
    } catch (error) {
      consecutiveFailures += 1
      const delayMs = workerRetryDelay(schedule.intervalMs, consecutiveFailures, schedule.maximumBackoffMs)
      const nextRunAt = new Date(Date.now() + delayMs)
      markWorkerFailed(worker, nextRunAt)
      const operation = error && typeof error === 'object' && 'operation' in error && typeof error.operation === 'string' ? error.operation : 'worker.run'
      console.error('MarketHub background worker failed', {
        worker,
        operation,
        consecutiveFailures,
        nextRetryMs: delayMs,
        ...safeWorkerError(error),
      })
      scheduleNext(delayMs)
    } finally {
      running = false
    }
  }

  void execute()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    setWorkerEnabled(worker, false)
  }
}