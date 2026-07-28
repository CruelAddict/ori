import type { QueryResultView } from "@adapters/ori/client"
import type { QueryJob, QueryTask, QueryUsecase } from "@usecase/query/usecase"
import { type SqlScan, scanSql } from "@utils/sql-scanner"
import type { Logger } from "pino"

export const DEFAULT_AUTO_LIMIT_ROWS = 500

export type ResultSourcePage = {
  pageSize: number
  offset: number
  totalRows: number
  isTotalRowsExact: boolean
}

export type ResultSource = {
  query: string
  job: QueryJob
  pagination?: ResultSourcePage
}

export type ResultSourceState = {
  current?: ResultSource
  navigation?: { kind: "count" }
}

export type ResultSourceQueryPlan = {
  query: string
  sourceQuery: string
  maxRows?: number
  pagination?: ResultSourcePage
}

type Query = Pick<QueryUsecase, "execute">
type Listener = () => void
type PaginatedResultSource = ResultSource & { pagination: ResultSourcePage }

export type ResultSourceUsecaseDeps = {
  resourceName: string
  logger: Logger
  query: Query
  getAutoLimitRows: () => number | null | undefined
}

export function createResultSourceUC(deps: ResultSourceUsecaseDeps) {
  let state: ResultSourceState = {}
  let currentTask: QueryTask | undefined
  let navigationTask: QueryTask | undefined
  let currentGeneration = 0
  let pendingLastPageRequest: Promise<string | undefined> | undefined
  const listeners = new Set<Listener>()

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setState = (next: ResultSourceState) => {
    state = next
    emit()
  }

  const cancelNavigation = () => {
    navigationTask?.cancel()
    navigationTask = undefined
    pendingLastPageRequest = undefined
    if (state.navigation) {
      setState({ current: state.current })
    }
  }

  const startCurrent = (
    query: string,
    sourceQuery: string,
    pagination: ResultSourcePage | undefined,
    maxRows?: number,
  ) => {
    cancelNavigation()
    currentTask?.cancel()
    const generation = ++currentGeneration
    const task = deps.query.execute(query, maxRows === undefined ? undefined : { maxRows }, {
      onUpdate: (job) => {
        if (generation !== currentGeneration) {
          return
        }
        const page =
          job.status === "success" && job.result && pagination
            ? updatePageTotalRows(pagination, job.result)
            : pagination
        setState({
          current: {
            query: sourceQuery,
            job,
            pagination: page,
          },
          navigation: state.navigation,
        })
      },
    })
    currentTask = task
    return task.jobId
  }

  const currentIdleSource = () => {
    const current = state.current
    if (!current || state.navigation || current.job.status === "running") {
      return undefined
    }
    return current
  }

  const currentIdlePaginatedSource = () => {
    const current = currentIdleSource()
    if (!current?.pagination) {
      return undefined
    }
    return current as PaginatedResultSource
  }

  const executePage = (
    current: PaginatedResultSource,
    offset: number,
    totalRows = current.pagination.totalRows,
    isTotalRowsExact = current.pagination.isTotalRowsExact,
  ) => {
    const page = createPage(current.pagination.pageSize, offset, totalRows, isTotalRowsExact)
    return startCurrent(buildPageQuery(current.query, page), current.query, page, page.pageSize)
  }

  const executeQuery = (query: string) => {
    const plan = buildResultSourceQuery(query, resolveAutoLimitRows(deps.getAutoLimitRows()))
    return startCurrent(plan.query, plan.sourceQuery, plan.pagination, plan.maxRows)
  }

  const failQuery = (query: string, error: string) => {
    cancelNavigation()
    currentTask?.cancel()
    currentTask = undefined
    currentGeneration += 1
    const now = Date.now()
    const job: QueryJob = {
      jobId: crypto.randomUUID(),
      resourceName: deps.resourceName,
      query,
      status: "failed",
      startedAt: now,
      finishedAt: now,
      error,
    }
    setState({ current: { query, job } })
    return job.jobId
  }

  const loadFirstPage = () => {
    const current = currentIdlePaginatedSource()
    if (!current || current.pagination.offset <= 0) {
      return undefined
    }
    return executePage(current, 0)
  }

  const loadPreviousPage = () => {
    const current = currentIdlePaginatedSource()
    if (!current || current.pagination.offset <= 0) {
      return undefined
    }
    if (isOutOfRangePage(current.job.result, current.pagination)) {
      void loadLastPage()
      return undefined
    }
    return executePage(current, Math.max(0, current.pagination.offset - current.pagination.pageSize))
  }

  const loadNextPage = () => {
    const current = currentIdlePaginatedSource()
    if (!current?.job.result) {
      return undefined
    }
    const offset = current.pagination.offset + current.pagination.pageSize
    if (current.pagination.isTotalRowsExact && offset >= current.pagination.totalRows) {
      return undefined
    }
    if (!current.job.result.truncated) {
      return undefined
    }
    return executePage(current, offset)
  }

  const loadLastPage = async () => {
    if (pendingLastPageRequest) {
      return await pendingLastPageRequest
    }
    const current = currentIdlePaginatedSource()
    if (!current) {
      return undefined
    }
    const task = deps.query.execute(buildCountQuery(current.query), { maxRows: 1 })
    navigationTask = task
    setState({ current, navigation: { kind: "count" } })
    const request = (async () => {
      const outcome = await task.done
      if (navigationTask !== task || state.current !== current || outcome.status !== "success" || !outcome.result) {
        return undefined
      }
      const totalRows = parseCountResult(outcome.result)
      const lastOffset =
        Math.floor(Math.max(0, totalRows - 1) / current.pagination.pageSize) * current.pagination.pageSize
      return executePage(current, lastOffset, totalRows, true)
    })()
      .catch((err) => {
        deps.logger.error({ err, resourceName: deps.resourceName }, "failed to count paginated rows")
        return undefined
      })
      .finally(() => {
        if (pendingLastPageRequest === request) {
          pendingLastPageRequest = undefined
        }
        if (navigationTask === task) {
          navigationTask = undefined
          setState({ current: state.current })
        }
      })
    pendingLastPageRequest = request
    return await request
  }

  return {
    getState: () => state,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    executeQuery,
    failQuery,
    loadFirstPage,
    loadPreviousPage,
    loadNextPage,
    loadLastPage,
    cancel: () => {
      if (navigationTask) {
        cancelNavigation()
        return
      }
      currentTask?.cancel()
    },
    dispose: () => {
      currentGeneration += 1
      currentTask?.cancel()
      currentTask = undefined
      cancelNavigation()
      listeners.clear()
      state = {}
    },
  }
}

export type ResultSourceUsecase = ReturnType<typeof createResultSourceUC>

export function buildResultSourceQuery(query: string, autoLimitRows: number | null): ResultSourceQueryPlan {
  const sourceQuery = query.trim()
  const scan = scanSql(sourceQuery)
  if (autoLimitRows === null || !canAutoLimit(scan)) {
    return { query, sourceQuery }
  }

  const normalizedQuery = removeStatementTerminator(sourceQuery, scan.terminatorIndex)
  const page = createPage(autoLimitRows, 0, autoLimitRows + 1, false)
  return {
    query: buildPageQuery(normalizedQuery, page),
    sourceQuery: normalizedQuery,
    maxRows: page.pageSize,
    pagination: page,
  }
}

function createPage(pageSize: number, offset: number, totalRows: number, isTotalRowsExact: boolean): ResultSourcePage {
  return {
    pageSize: Math.max(1, Math.floor(pageSize)),
    offset: Math.max(0, Math.floor(offset)),
    totalRows: Math.max(0, Math.floor(totalRows)),
    isTotalRowsExact,
  }
}

function updatePageTotalRows(page: ResultSourcePage, result: QueryResultView): ResultSourcePage {
  if (!result.truncated) {
    if (isOutOfRangePage(result, page)) {
      return page
    }
    const totalRows = page.offset + result.rows.length
    if (page.isTotalRowsExact && page.totalRows === totalRows) {
      return page
    }
    return createPage(page.pageSize, page.offset, totalRows, true)
  }

  const totalRows = page.offset + result.rows.length + 1
  if (page.isTotalRowsExact && totalRows <= page.totalRows) {
    return page
  }
  const estimatedTotalRows = Math.max(page.totalRows, totalRows)
  if (!page.isTotalRowsExact && page.totalRows === estimatedTotalRows) {
    return page
  }
  return createPage(page.pageSize, page.offset, estimatedTotalRows, false)
}

function isOutOfRangePage(result: QueryResultView | undefined, page: ResultSourcePage): boolean {
  return page.offset > 0 && result?.rows.length === 0 && !result.truncated
}

function resolveAutoLimitRows(value: number | null | undefined): number | null {
  if (value === null) {
    return null
  }
  if (value === undefined) {
    return DEFAULT_AUTO_LIMIT_ROWS
  }
  return Math.max(1, Math.floor(value))
}

function buildPageQuery(query: string, page: ResultSourcePage): string {
  return `${query}\nLIMIT ${page.pageSize + 1} OFFSET ${page.offset}`
}

function buildCountQuery(query: string): string {
  return `SELECT COUNT(*) AS __ori_total_rows FROM (\n${query}\n) AS __ori_count`
}

function parseCountResult(result: QueryResultView): number {
  const value = result.rows[0]?.[0]
  const count = typeof value === "number" ? value : Number(value)
  if (Number.isFinite(count) && count >= 0) {
    return count
  }
  throw new Error("count query returned an invalid value")
}

function canAutoLimit(scan: SqlScan): boolean {
  if (scan.firstKeyword !== "select" || scan.hasMultipleStatements) {
    return false
  }
  return !["fetch", "for", "into", "limit", "offset"].some((keyword) => scan.topLevelKeywords.has(keyword))
}

function removeStatementTerminator(query: string, terminatorIndex: number | undefined): string {
  if (terminatorIndex === undefined) {
    return query
  }
  return `${query.slice(0, terminatorIndex)}${query.slice(terminatorIndex + 1)}`.trimEnd()
}
