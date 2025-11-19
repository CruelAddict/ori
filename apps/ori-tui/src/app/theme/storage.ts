import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
const APP_DIR = path.join(CONFIG_DIR, "ori-tui");
const THEME_FILE = path.join(APP_DIR, "theme.json");

export function readStoredTheme(): string | undefined {
    try {
        const data = fs.readFileSync(THEME_FILE, "utf8");
        const parsed = JSON.parse(data);
        if (typeof parsed?.theme === "string") {
            return parsed.theme;
        }
    } catch {
        // ignore missing or invalid files
    }
    return undefined;
}

export function writeStoredTheme(theme: string) {
    try {
        fs.mkdirSync(APP_DIR, { recursive: true });
        fs.writeFileSync(THEME_FILE, JSON.stringify({ theme }, null, 2), "utf8");
    } catch {
        // ignore write failures, theme just won't persist
    }
}
