import path from "node:path";
import fs from "node:fs";
import { getAppDataDir } from "@src/shared/lib/data-storage";

function getConnectionDir(connectionName: string): string {
    return path.join(getAppDataDir(), "connections", connectionName);
}

function getConsoleFilePath(connectionName: string): string {
    return path.join(getConnectionDir(connectionName), ".console.sql");
}

export function readConsoleQuery(connectionName: string): string | undefined {
    const filepath = getConsoleFilePath(connectionName);
    if (!fs.existsSync(filepath)) {
        return undefined;
    }
    return fs.readFileSync(filepath, "utf8");
}

export function writeConsoleQuery(connectionName: string, query: string): boolean {
    const dir = getConnectionDir(connectionName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getConsoleFilePath(connectionName), query, "utf8");
    return true;
}
