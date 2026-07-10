import type { QueryResultView } from "@adapters/ori/client"
import type { QueryUsecase } from "@usecase/query/usecase"
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
  jobId: string
  pagination?: ResultSourcePage
}

export type ResultSourceState = {
  current?: ResultSource
}

export type ResultSourceQueryPlan = {
  query: string
  sourceQuery: string
  maxRows?: number
  pagination?: ResultSourcePage
}

type Query = Pick<QueryUsecase, "executeQuery" | "failQuery" | "getJob" | "subscribe" | "waitForResult">
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

  const setCurrent = (current: ResultSource | undefined) => {
    setState({ current })
  }

  const refreshCurrentPage = () => {
    const current = state.current
    if (!current?.pagination) {
      return current
    }
    const job = deps.query.getJob(current.jobId)
    if (job?.status !== "success" || !job.result) {
      return current
    }

    const page = updatePageTotalRows(current.pagination, job.result)
    if (page === current.pagination) {
      return current
    }

    const next = { ...current, pagination: page }
    setCurrent(next)
    return next
  }

  const currentRunningJobId = () => {
    const current = state.current
    if (!current) {
      return undefined
    }
    const job = deps.query.getJob(current.jobId)
    if (job?.status === "running") {
      return current.jobId
    }
    return undefined
  }

  const currentIdleSource = () => {
    const current = refreshCurrentPage()
    if (!current) {
      return undefined
    }
    if (currentRunningJobId()) {
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
    const jobId = deps.query.executeQuery(buildPageQuery(current.query, page), { maxRows: page.pageSize })
    setCurrent({ ...current, jobId, pagination: page })
    return jobId
  }

  const executeQuery = (query: string) => {
    const runningJobId = currentRunningJobId()
    if (runningJobId) {
      return runningJobId
    }

    const plan = buildResultSourceQuery(query, resolveAutoLimitRows(deps.getAutoLimitRows()))
    const jobId = deps.query.executeQuery(
      plan.query,
      plan.maxRows === undefined ? undefined : { maxRows: plan.maxRows },
    )
    setCurrent({
      query: plan.sourceQuery,
      jobId,
      pagination: plan.pagination,
    })
    return jobId
  }

  const failQuery = (query: string, error: string) => {
    const runningJobId = currentRunningJobId()
    if (runningJobId) {
      return runningJobId
    }
    const jobId = deps.query.failQuery(query, error)
    setCurrent({ query, jobId })
    return jobId
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
    return executePage(current, Math.max(0, current.pagination.offset - current.pagination.pageSize))
  }

  const loadNextPage = () => {
    const current = refreshCurrentPage()
    if (!current?.pagination) {
      return undefined
    }
    const job = deps.query.getJob(current.jobId)
    if (!job?.result) {
      return undefined
    }

    const offset = current.pagination.offset + current.pagination.pageSize
    if (current.pagination.isTotalRowsExact && offset >= current.pagination.totalRows) {
      return undefined
    }
    if (!job.result.truncated) {
      return undefined
    }

    return executePage(current as PaginatedResultSource, offset)
  }

  const loadLastPage = async () => {
    const current = currentIdlePaginatedSource()
    if (!current) {
      return undefined
    }

    const totalRows = current.pagination.isTotalRowsExact
      ? current.pagination.totalRows
      : await loadTotalRows(deps, current)
    if (totalRows === undefined || state.current !== current) {
      return undefined
    }

    const lastOffset =
      Math.floor(Math.max(0, totalRows - 1) / current.pagination.pageSize) * current.pagination.pageSize
    return executePage(current, lastOffset, totalRows, true)
  }

  deps.query.subscribe(refreshCurrentPage)

  return {
    getState: () => state,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    executeQuery,
    failQuery,
    loadFirstPage,
    loadPreviousPage,
    loadNextPage,
    loadLastPage,
  }
}

export type ResultSourceUsecase = ReturnType<typeof createResultSourceUC>

export function buildResultSourceQuery(query: string, autoLimitRows: number | null): ResultSourceQueryPlan {
  const sourceQuery = query.trim()
  if (autoLimitRows === null || !canAutoLimit(sourceQuery)) {
    return { query, sourceQuery }
  }

  const page = createPage(autoLimitRows, 0, autoLimitRows + 1, false)
  return {
    query: buildPageQuery(sourceQuery, page),
    sourceQuery: stripTrailingStatementTerminator(sourceQuery),
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
  return `${stripTrailingStatementTerminator(query)} LIMIT ${page.pageSize + 1} OFFSET ${page.offset}`
}

function buildCountQuery(query: string): string {
  return `SELECT COUNT(*) AS __ori_total_rows FROM (${stripTrailingStatementTerminator(query)}) AS __ori_count`
}

async function loadTotalRows(
  deps: Pick<ResultSourceUsecaseDeps, "logger" | "query" | "resourceName">,
  source: PaginatedResultSource,
): Promise<number | undefined> {
  const jobId = deps.query.executeQuery(buildCountQuery(source.query), { maxRows: 1 })
  return await deps.query
    .waitForResult(jobId)
    .then(parseCountResult)
    .catch((err) => {
      deps.logger.error({ err, resourceName: deps.resourceName }, "failed to count paginated rows")
      return undefined
    })
}

function parseCountResult(result: QueryResultView): number {
  const value = result.rows[0]?.[0]
  const count = typeof value === "number" ? value : Number(value)
  if (Number.isFinite(count) && count >= 0) {
    return count
  }
  throw new Error("count query returned an invalid value")
}

function canAutoLimit(query: string): boolean {
  const scan = scanSql(query)
  if (scan.firstKeyword !== "SELECT" || scan.hasMultipleStatements) {
    return false
  }
  return (
    !scan.topLevelKeywords.has("WHERE") && !scan.topLevelKeywords.has("LIMIT") && !scan.topLevelKeywords.has("OFFSET")
  )
}

function scanSql(query: string) {
  let index = 0
  let depth = 0
  let firstKeyword: string | undefined
  let hasMultipleStatements = false
  const topLevelKeywords = new Set<string>()

  for (; index < query.length; ) {
    const char = query[index]
    const next = query[index + 1]

    if (char === "-" && next === "-") {
      index = skipLineComment(query, index + 2)
      continue
    }
    if (char === "/" && next === "*") {
      index = skipBlockComment(query, index + 2)
      continue
    }
    if (char === "'") {
      index = skipQuoted(query, index + 1, "'")
      continue
    }
    if (char === '"') {
      index = skipQuoted(query, index + 1, '"')
      continue
    }
    if (char === "`") {
      index = skipQuoted(query, index + 1, "`")
      continue
    }
    if (char === "[") {
      index = skipBracketQuoted(query, index + 1)
      continue
    }
    if (char === "$") {
      const nextIndex = skipDollarQuoted(query, index)
      if (nextIndex !== index) {
        index = nextIndex
        continue
      }
    }
    if (char === "(") {
      depth += 1
      index += 1
      continue
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1)
      index += 1
      continue
    }
    if (depth === 0 && char === ";") {
      if (hasNonWhitespaceAfter(query, index + 1)) {
        hasMultipleStatements = true
      }
      index += 1
      continue
    }
    if (depth === 0 && isKeywordStart(char)) {
      const start = index
      index += 1
      for (; index < query.length && isKeywordPart(query[index]); index += 1) {}
      const keyword = query.slice(start, index).toUpperCase()
      firstKeyword ??= keyword
      topLevelKeywords.add(keyword)
      continue
    }

    index += 1
  }

  return { firstKeyword, hasMultipleStatements, topLevelKeywords }
}

function stripTrailingStatementTerminator(query: string): string {
  const trimmed = query.trim()
  if (!trimmed.endsWith(";")) {
    return trimmed
  }
  return trimmed.slice(0, -1).trimEnd()
}

function skipLineComment(query: string, index: number): number {
  for (; index < query.length && query[index] !== "\n"; index += 1) {}
  return index
}

function skipBlockComment(query: string, index: number): number {
  for (; index + 1 < query.length; index += 1) {
    if (query[index] === "*" && query[index + 1] === "/") {
      return index + 2
    }
  }
  return query.length
}

function skipQuoted(query: string, index: number, quote: string): number {
  for (; index < query.length; index += 1) {
    if (query[index] !== quote) {
      continue
    }
    if (query[index + 1] === quote) {
      index += 1
      continue
    }
    return index + 1
  }
  return query.length
}

function skipBracketQuoted(query: string, index: number): number {
  for (; index < query.length; index += 1) {
    if (query[index] === "]") {
      return index + 1
    }
  }
  return query.length
}

function skipDollarQuoted(query: string, index: number): number {
  const match = query.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)
  if (!match) {
    return index
  }
  const tag = match[0]
  const end = query.indexOf(tag, index + tag.length)
  if (end === -1) {
    return query.length
  }
  return end + tag.length
}

function hasNonWhitespaceAfter(query: string, index: number): boolean {
  for (; index < query.length; index += 1) {
    if (!isWhitespace(query[index])) {
      return true
    }
  }
  return false
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r"
}

function isKeywordStart(char: string | undefined): boolean {
  if (char === undefined) {
    return false
  }
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z")
}

function isKeywordPart(char: string | undefined): boolean {
  if (char === undefined) {
    return false
  }
  return isKeywordStart(char) || (char >= "0" && char <= "9") || char === "_"
}
