import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const DEFAULT_RESOURCES_CONTENT = '{\n  "resources": []\n}\n'

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function resolveResourcesPath(explicit?: string): Promise<string> {
  if (explicit) {
    const absolute = path.resolve(explicit)
    if (!(await fileExists(absolute))) {
      throw new Error(`config file not found: ${absolute}`)
    }
    return absolute
  }

  const cwd = process.cwd()
  const localConfig = path.join(cwd, ".resources.json")
  if (await fileExists(localConfig)) {
    return localConfig
  }

  const home = os.homedir()
  if (!home) {
    throw new Error("failed to determine home directory for config search")
  }

  const configDir = path.join(home, ".config", "ori")
  await fs.mkdir(configDir, { recursive: true, mode: 0o755 })

  const userConfig = path.join(configDir, "resources.json")
  if (await fileExists(userConfig)) {
    return userConfig
  }

  await fs.writeFile(userConfig, DEFAULT_RESOURCES_CONTENT, { mode: 0o644 })
  return userConfig
}
