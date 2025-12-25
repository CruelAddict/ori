import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "pino";
import pino from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";

export function createLogger(app: string, level: LogLevel = "warn"): Logger {
  const logDir = defaultLogDir();
  fs.mkdirSync(logDir, { recursive: true });
  const filePath = path.join(logDir, `${app}.log`);

  const destination = pino.destination({ dest: filePath, append: true, mkdir: true, sync: false });

  // Reopen log file on SIGHUP to cooperate with external log rotation
  try {
    process.on("SIGHUP", () => {
      const maybe = destination as unknown as { reopen?: () => void };
      if (typeof maybe.reopen === "function") {
        maybe.reopen();
      }
    });
  } catch {}

  const logger = pino(
    {
      level,
      base: { app },
      messageKey: "msg",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    },
    destination,
  );

  return logger;
}

function defaultLogDir(): string {
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) {
    return path.join(xdg, "ori");
  }
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Logs", "ori");
  }
  return path.join(home, ".local", "state", "ori");
}
