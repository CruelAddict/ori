import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function runtimeTmpFilesDir(): string {
    const xdg = process.env.XDG_RUNTIME_DIR;
    if (xdg && xdg.length > 0) {
        return path.join(xdg, "ori");
    }
    const home = os.homedir();
    if (home && home.length > 0) {
        return path.join(home, ".cache", "ori");
    }
    return path.join(os.tmpdir(), "ori");
}

export async function ensureRuntimeDir(): Promise<string> {
    const dir = runtimeTmpFilesDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    return dir;
}

export function hashPath(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function socketPathForConfig(runtimeDir: string, _: string): string {
    // initially, the idea was to reuse backend that look at the same config. maybe we'll return to it one day, but not now
    // const hashed = hashPath(configPath);
    // return path.join(runtimeDir, `ori-${hashed}.sock`);
    const random = crypto.randomBytes(8).toString("hex");
    return path.join(runtimeDir, `ori-${random}.sock`);
}
