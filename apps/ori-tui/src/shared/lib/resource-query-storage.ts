import fs from "node:fs"
import path from "node:path"
import { getAppDataDir } from "@src/shared/lib/data-storage"

function getResourceDir(resourceName: string): string {
  return path.join(getAppDataDir(), "resources", resourceName)
}

export function getConsoleFilePath(resourceName: string): string {
  return path.join(getResourceDir(resourceName), ".console.sql")
}

export function readConsoleQuery(resourceName: string): string | undefined {
  const filepath = getConsoleFilePath(resourceName)
  if (!fs.existsSync(filepath)) {
    return undefined
  }
  return fs.readFileSync(filepath, "utf8")
}

export function writeConsoleQuery(resourceName: string, query: string): boolean {
  const dir = getResourceDir(resourceName)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getConsoleFilePath(resourceName), query, "utf8")
  return true
}
