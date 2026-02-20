import fs from "node:fs"
import path from "node:path"
import { getAppDataDir } from "@usecase/script/data-dir"

function getResourceDir(resourceName: string): string {
  return path.join(getAppDataDir(), "resources", resourceName)
}

export function getScriptFilePath(resourceName: string): string {
  return path.join(getResourceDir(resourceName), ".console.sql")
}

export function readScript(resourceName: string): string | undefined {
  const filepath = getScriptFilePath(resourceName)
  if (!fs.existsSync(filepath)) {
    return undefined
  }
  return fs.readFileSync(filepath, "utf8")
}

export function writeScript(resourceName: string, script: string): boolean {
  const dir = getResourceDir(resourceName)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getScriptFilePath(resourceName), script, "utf8")
  return true
}
