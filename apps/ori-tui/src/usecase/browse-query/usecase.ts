type BrowseQuerySource = {
  getQualifiedName(): string
}

export function buildBrowseQuery(source: BrowseQuerySource): string {
  return `SELECT * FROM ${source.getQualifiedName()}`
}
