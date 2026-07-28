import {
  type OriClient,
  OriRequestError,
  type QueryExecOptions,
  type QueryExecResult,
  type QueryJobStatusView,
  type QueryResultView,
} from "@adapters/ori/client"
import { QUERY_JOB_COMPLETED_EVENT, type QueryJobCompletedEvent, type ServerEvent } from "@model/events"
import { retry, wait } from "@utils/retry"
import type { Logger } from "pino"

const QUERY_STATUS_INITIAL_POLL_DELAY_MS = 10_000
const QUERY_STATUS_POLL_INTERVAL_MS = 30_000
const QUERY_STATUS_TIMEOUT_MS = 3_000
const QUERY_STATUS_FAILURE_DELAY_MS = 30_000
const QUERY_STATUS_MAX_FAILURE_DELAY_MS = 300_000
const QUERY_STATUS_WARNING_FAILURES = 2
const QUERY_CANCEL_TIMEOUT_MS = 3_000
const QUERY_EXEC_TIMEOUT_MS = 3_000
const MAX_RESULT_ATTEMPTS = 5
const QUERY_RESULT_RETRY_INITIAL_DELAY_MS = 100
const QUERY_RESULT_TIMEOUT_MS = 10_000

export type QueryJob = {
  jobId: string
  resourceName: string
  query: string
  status: "running" | "success" | "failed" | "canceled"
  startedAt: number
  finishedAt?: number
  result?: QueryResultView
  error?: string
  message?: string
  durationMs?: number
  statusUnavailable?: boolean
}

export type QueryOutcome = QueryJob & { status: "success" | "failed" | "canceled" }

export type QueryTask = {
  jobId: string
  done: Promise<QueryOutcome>
  cancel(): void
}

export type QueryExecutionOptions = {
  onUpdate?: (job: QueryJob) => void
}

type JobRuntime = {
  job: QueryJob
  resolve: (outcome: QueryOutcome) => void
  onUpdate?: (job: QueryJob) => void
  pollController: AbortController
  execController: AbortController
  execTimeout?: ReturnType<typeof setTimeout>
  resultController?: AbortController
  cancellation?: Promise<void>
  cancelRequested: boolean
  submission: "pending" | "accepted" | "unknown" | "rejected"
  settling: boolean
  finished: boolean
  statusFailures: number
}

export type QueryUsecaseDeps = {
  resourceName: string
  client: OriClient
  logger: Logger
  subscribeEvents: (listener: (event: ServerEvent) => void) => () => void
  statusPollInitialDelayMs?: number
  statusPollIntervalMs?: number
  statusPollTimeoutMs?: number
  statusPollFailureDelayMs?: number
  statusPollMaxFailureDelayMs?: number
  statusPollRandom?: () => number
  cancelRequestTimeoutMs?: number
  execRequestTimeoutMs?: number
  resultRetryInitialDelayMs?: number
  resultRequestTimeoutMs?: number
}

export type QueryUsecase = {
  execute(query: string, options?: QueryExecOptions, execution?: QueryExecutionOptions): QueryTask
  dispose(): void
}

export function createQueryUC(deps: QueryUsecaseDeps): QueryUsecase {
  const runtimes = new Map<string, JobRuntime>()

  const notify = (runtime: JobRuntime) => {
    try {
      runtime.onUpdate?.(runtime.job)
    } catch (err) {
      deps.logger.error({ err, jobId: runtime.job.jobId }, "query update listener failed")
    }
  }

  const updateJob = (runtime: JobRuntime, recipe: (job: QueryJob) => QueryJob) => {
    if (runtimes.get(runtime.job.jobId) !== runtime || runtime.finished) {
      return
    }
    runtime.job = recipe(runtime.job)
    notify(runtime)
  }

  const finish = (runtime: JobRuntime, status: QueryOutcome["status"], error?: string, result?: QueryResultView) => {
    if (runtime.finished) {
      return
    }
    runtime.finished = true
    runtime.pollController.abort()
    runtime.execController.abort()
    clearTimeout(runtime.execTimeout)
    runtime.resultController?.abort()
    runtimes.delete(runtime.job.jobId)
    const outcome: QueryOutcome = {
      ...runtime.job,
      status,
      finishedAt: runtime.job.finishedAt ?? Date.now(),
      error,
      result,
    }
    runtime.job = outcome
    notify(runtime)
    runtime.resolve(outcome)
  }

  const requestCancellation = (runtime: JobRuntime) => {
    if (runtime.cancellation) {
      return runtime.cancellation
    }
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new Error("query cancellation request timed out")),
      deps.cancelRequestTimeoutMs ?? QUERY_CANCEL_TIMEOUT_MS,
    )
    const request = deps.client
      .queryCancel(runtime.job.jobId, controller.signal)
      .catch((err) => {
        deps.logger.debug({ err, jobId: runtime.job.jobId }, "query cancellation was not acknowledged")
      })
      .finally(() => {
        clearTimeout(timeout)
        if (runtime.cancellation === request) {
          runtime.cancellation = undefined
        }
      })
    runtime.cancellation = request
    return request
  }

  const cancel = (runtime: JobRuntime) => {
    if (runtime.finished) {
      return
    }
    runtime.cancelRequested = true
    updateJob(runtime, (job) => ({ ...job, cancelRequested: true }))
    runtime.resultController?.abort()
    void requestCancellation(runtime)
  }

  const settleStatus = async (runtime: JobRuntime, status: QueryJobStatusView) => {
    if (
      runtime.finished ||
      runtime.settling ||
      status.jobId !== runtime.job.jobId ||
      status.resourceName !== deps.resourceName
    ) {
      return
    }
    if (status.status === "running") {
      runtime.statusFailures = 0
      if (runtime.job.statusUnavailable) {
        updateJob(runtime, (job) => ({ ...job, statusUnavailable: false }))
      }
      return
    }

    runtime.settling = true
    runtime.pollController.abort()
    runtime.job = {
      ...runtime.job,
      finishedAt: status.finishedAt ?? Date.now(),
      durationMs: status.durationMs,
      error: status.error,
    }
    if (status.status !== "success" || !status.stored) {
      finish(runtime, status.status === "success" ? "failed" : status.status, status.error, undefined)
      return
    }

    const controller = new AbortController()
    runtime.resultController = controller
    try {
      const result = await retry(
        () =>
          deps.client.queryGetResult(
            runtime.job.jobId,
            undefined,
            undefined,
            AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(deps.resultRequestTimeoutMs ?? QUERY_RESULT_TIMEOUT_MS),
            ]),
          ),
        {
          maxAttempts: MAX_RESULT_ATTEMPTS,
          initialDelayMs: deps.resultRetryInitialDelayMs ?? QUERY_RESULT_RETRY_INITIAL_DELAY_MS,
          signal: controller.signal,
          onRetry: (err, attempt) => {
            deps.logger.debug({ err, attempt, jobId: runtime.job.jobId }, "query result fetch failed; will retry")
          },
        },
      )
      finish(runtime, "success", undefined, result)
    } catch (err) {
      if (controller.signal.aborted && runtime.cancelRequested) {
        finish(runtime, "canceled", "query canceled")
        return
      }
      const error = err instanceof Error ? err.message : String(err)
      deps.logger.error({ err, jobId: runtime.job.jobId }, "query result could not be retrieved after retries")
      finish(runtime, "failed", `query result could not be retrieved: ${error}`)
    }
  }

  const reconcile = async (runtime: JobRuntime) => {
    let delay = statusPollInitialDelay(deps)
    while (!runtime.finished && !runtime.settling) {
      try {
        await wait(delay, runtime.pollController.signal)
      } catch {
        return
      }
      if (runtime.finished || runtime.settling) {
        return
      }

      try {
        const signal = AbortSignal.any([runtime.pollController.signal, AbortSignal.timeout(statusPollTimeout(deps))])
        const status = await deps.client.queryGetStatus(runtime.job.jobId, signal)
        await settleStatus(runtime, status)
        delay = statusPollInterval(deps)
      } catch (err) {
        if (runtime.pollController.signal.aborted || runtime.finished || runtime.settling) {
          return
        }
        if (err instanceof OriRequestError && err.code === "job_not_found" && runtime.submission !== "pending") {
          finish(runtime, "failed", err.message)
          return
        }
        runtime.statusFailures += 1
        if (runtime.statusFailures >= QUERY_STATUS_WARNING_FAILURES && !runtime.job.statusUnavailable) {
          updateJob(runtime, (job) => ({ ...job, statusUnavailable: true }))
        }
        delay = statusFailureDelay(runtime.statusFailures, deps)
        deps.logger.debug(
          { err, jobId: runtime.job.jobId, nextDelay: delay },
          "query status reconciliation failed; will retry",
        )
      }
    }
  }

  const execute = (query: string, options?: QueryExecOptions, execution?: QueryExecutionOptions): QueryTask => {
    const jobId = generateJobId()
    let resolve: (outcome: QueryOutcome) => void = () => {}
    const done = new Promise<QueryOutcome>((resolvePromise) => {
      resolve = resolvePromise
    })
    const runtime: JobRuntime = {
      job: {
        jobId,
        resourceName: deps.resourceName,
        query,
        status: "running",
        startedAt: Date.now(),
      },
      resolve,
      onUpdate: execution?.onUpdate,
      pollController: new AbortController(),
      execController: new AbortController(),
      cancelRequested: false,
      submission: "pending",
      settling: false,
      finished: false,
      statusFailures: 0,
    }
    runtimes.set(jobId, runtime)
    notify(runtime)

    runtime.execTimeout = setTimeout(() => {
      if (runtime.finished || runtime.settling || runtime.submission !== "pending") {
        return
      }
      runtime.submission = "unknown"
      runtime.execController.abort(new Error("query execution request timed out"))
      deps.logger.error({ jobId, resourceName: deps.resourceName }, "query execution acknowledgement timed out")
    }, deps.execRequestTimeoutMs ?? QUERY_EXEC_TIMEOUT_MS)

    void executeQueryRequest(
      deps.client,
      deps.logger,
      deps.resourceName,
      query,
      jobId,
      options,
      runtime.execController.signal,
    )
      .then((result) => {
        if (runtime.finished || runtime.settling) {
          return
        }
        runtime.submission = "accepted"
        if (result.status === "failed") {
          finish(runtime, "failed", result.message || "query failed")
          return
        }
        if (runtime.cancelRequested) {
          void requestCancellation(runtime)
        }
      })
      .catch((err) => {
        if (runtime.finished || runtime.settling) {
          return
        }
        if (runtime.execController.signal.aborted && runtime.submission === "unknown") {
          return
        }
        if (err instanceof OriRequestError) {
          runtime.submission = "rejected"
          finish(runtime, "failed", err.message)
          return
        }
        runtime.submission = "unknown"
        deps.logger.error({ jobId, resourceName: deps.resourceName, err }, "query execution acknowledgement failed")
        if (runtime.cancelRequested) {
          void requestCancellation(runtime)
        }
      })
      .finally(() => {
        clearTimeout(runtime.execTimeout)
      })
    void reconcile(runtime)

    return { jobId, done, cancel: () => cancel(runtime) }
  }

  const handleQueryJobCompleted = (event: QueryJobCompletedEvent) => {
    const { jobId, resourceName, status, error, message, stored, finishedAt, durationMs } = event.payload
    const runtime = runtimes.get(jobId)
    if (!runtime || resourceName !== deps.resourceName) {
      return
    }
    void settleStatus(runtime, {
      jobId,
      resourceName,
      status: status === "success" || status === "failed" || status === "canceled" ? status : "failed",
      finishedAt: parseFinishedAt(finishedAt),
      durationMs,
      error: error ?? message,
      stored,
    })
  }

  const unsubscribeEvents = deps.subscribeEvents((event) => {
    if (event.type === QUERY_JOB_COMPLETED_EVENT) {
      handleQueryJobCompleted(event)
    }
  })

  return {
    execute,
    dispose: () => {
      unsubscribeEvents()
      for (const runtime of runtimes.values()) {
        cancel(runtime)
        finish(runtime, "canceled", "query usecase disposed")
      }
    },
  }
}

async function executeQueryRequest(
  client: OriClient,
  logger: Logger,
  resourceName: string,
  query: string,
  jobId: string,
  options?: QueryExecOptions,
  signal?: AbortSignal,
): Promise<QueryExecResult> {
  try {
    return await client.queryExec(resourceName, jobId, query, undefined, options, signal)
  } catch (err) {
    logger.error({ err, resourceName, jobId }, "failed to execute query")
    throw err
  }
}

function parseFinishedAt(value: string): number | undefined {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function statusPollInitialDelay(deps: QueryUsecaseDeps) {
  return deps.statusPollInitialDelayMs ?? deps.statusPollIntervalMs ?? QUERY_STATUS_INITIAL_POLL_DELAY_MS
}

function statusPollInterval(deps: QueryUsecaseDeps) {
  return deps.statusPollIntervalMs ?? QUERY_STATUS_POLL_INTERVAL_MS
}

function statusPollTimeout(deps: QueryUsecaseDeps) {
  return deps.statusPollTimeoutMs ?? QUERY_STATUS_TIMEOUT_MS
}

function statusFailureDelay(failures: number, deps: QueryUsecaseDeps) {
  const initial = deps.statusPollFailureDelayMs ?? QUERY_STATUS_FAILURE_DELAY_MS
  const maximum = deps.statusPollMaxFailureDelayMs ?? QUERY_STATUS_MAX_FAILURE_DELAY_MS
  const cap = Math.min(maximum, initial * 2 ** Math.max(0, failures - 1))
  const random = deps.statusPollRandom?.() ?? Math.random()
  return Math.floor(cap / 2 + (cap / 2) * Math.max(0, Math.min(1, random)))
}

export const generateJobId = () => crypto.randomUUID()
