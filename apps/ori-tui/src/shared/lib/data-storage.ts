import path from "node:path";
import os from "node:os";

export function getAppDataDir(): string {
    if (process.env.XDG_DATA_HOME) {
        return path.join(process.env.XDG_DATA_HOME, "ori");
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", "ori");
    }
    return path.join(os.homedir(), ".local", "share", "ori");
}
