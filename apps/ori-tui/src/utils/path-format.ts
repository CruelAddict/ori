import path from "node:path"

const DEFAULT_MAX_LENGTH = 50

export type FormattedFilePath = {
  dirPath: string
  fileName: string
}

/**
 * Compacts file path if needed
 *
 * Returns dirPath and fileName separately for styling purposes.
 */
export function formatFilePath(filePath: string, maxLength = DEFAULT_MAX_LENGTH): FormattedFilePath {
  const segments = toNormalizedSegments(filePath)

  if (segments.length === 0) {
    return { dirPath: "", fileName: filePath }
  }
  if (segments.length === 1) {
    return { dirPath: "", fileName: segments[0] }
  }

  const absolutePrefix = filePath.startsWith(path.sep) && segments[0] !== "~" ? path.sep : ""
  const fileName = segments.at(-1)!
  const dirPath = segments.slice(0, -1)
  const dirPathStr = `${absolutePrefix}${dirPath.join(path.sep)}${path.sep}`

  if (dirPathStr.length + fileName.length <= maxLength) {
    return {
      dirPath: dirPathStr,
      fileName,
    }
  }

  const beforeTrunc = dirPath.slice(0, -2)
  const afterTrunc = dirPath.slice(-1)
  let dirPathTruncated = toPathStr(beforeTrunc, afterTrunc, absolutePrefix)
  while (dirPathTruncated.length + fileName.length > maxLength && (beforeTrunc.length > 0 || afterTrunc.length > 0)) {
    if (beforeTrunc.length > 0) {
      beforeTrunc.pop()
    } else {
      afterTrunc.pop()
    }
    dirPathTruncated = toPathStr(beforeTrunc, afterTrunc, absolutePrefix)
  }

  if (dirPathTruncated.length + fileName.length > maxLength) {
    return {
      dirPath: dirPathTruncated,
      fileName: truncateMiddle(fileName, maxLength - dirPathTruncated.length),
    }
  }

  return {
    dirPath: dirPathTruncated,
    fileName,
  }
}

function toPathStr(beforeTrunc: string[], afterTrunc: string[], prefix: string): string {
  const beforeStr = beforeTrunc.join(path.sep) + (beforeTrunc.length > 0 ? path.sep : "")
  const afterStr = (afterTrunc.length > 0 ? path.sep : "") + afterTrunc.join(path.sep)
  return `${prefix}${beforeStr}…${afterStr}${path.sep}`
}

function toNormalizedSegments(filePath: string): string[] {
  const homeDir = process.env.HOME ?? ""

  let normalizedPath = filePath
  if (homeDir && filePath.startsWith(`${homeDir}${path.sep}`)) {
    normalizedPath = "~" + filePath.slice(homeDir.length)
  }

  return normalizedPath.split(path.sep).filter(Boolean)
}

function truncateMiddle(value: string, limit: number): string {
  if (value.length <= limit) return value
  if (limit <= 1) return value.slice(0, limit)

  const remaining = limit - 1 // 1 char for ellipsis
  const head = Math.ceil(remaining / 2)
  const tail = Math.floor(remaining / 2)
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}
