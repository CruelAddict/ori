import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIG_CONTENT = "connections: []\n";

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function resolveConfigPath(explicit?: string): Promise<string> {
  if (explicit) {
    const absolute = path.resolve(explicit);
    if (!(await fileExists(absolute))) {
      throw new Error(`config file not found: ${absolute}`);
    }
    return absolute;
  }

  const cwd = process.cwd();
  const localConfig = path.join(cwd, ".ori-config.yaml");
  if (await fileExists(localConfig)) {
    return localConfig;
  }

  const home = os.homedir();
  if (!home) {
    throw new Error("failed to determine home directory for config search");
  }

  const configDir = path.join(home, ".config", "ori");
  await fs.mkdir(configDir, { recursive: true, mode: 0o755 });

  const userConfig = path.join(configDir, "config.yaml");
  if (await fileExists(userConfig)) {
    return userConfig;
  }

  await fs.writeFile(userConfig, DEFAULT_CONFIG_CONTENT, { mode: 0o644 });
  return userConfig;
}
