const DEFAULT_BROWSE_LIMIT = 500

type BrowseQuerySource = {
  getQualifiedName(): string
}

export type BrowseQueryOptions = {
  limit?: number
  offset?: number
}

export type BrowseQueryPlan = {
  query: string
  maxRows: number
}

export function buildBrowseQuery(source: BrowseQuerySource, options?: BrowseQueryOptions): BrowseQueryPlan {
  const limit = options?.limit ?? DEFAULT_BROWSE_LIMIT
  const offset = options?.offset ?? 0

  return {
    query: `SELECT * FROM ${source.getQualifiedName()} LIMIT ${limit + 1} OFFSET ${offset}`,
    maxRows: limit,
  }
}
