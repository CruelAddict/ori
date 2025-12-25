import { platform } from "node:os";
import type { Logger } from "pino";

export type RendererLike = {
  writeOut?: (data: string) => void;
};

const hasBunRuntime = typeof Bun !== "undefined";

function buildOsc52Payload(text: string): string {
  const base64 = Buffer.from(text).toString("base64");
  const osc52 = `\x1b]52;c;${base64}\x07`;
  return process.env.TMUX ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52;
}

function sendOsc52(text: string, renderer: unknown, logger?: Logger): boolean {
  const writer = renderer as RendererLike | undefined;
  if (!writer?.writeOut) {
    return false;
  }
  try {
    const payload = buildOsc52Payload(text);
    writer.writeOut(payload);
    return true;
  } catch (err) {
    logger?.warn({ err }, "clipboard: failed to send OSC52 payload");
    return false;
  }
}

function commandExists(command: string): boolean {
  return hasBunRuntime && Boolean(Bun.which(command));
}

async function runWithInput(command: string[], input: string): Promise<boolean> {
  if (!hasBunRuntime) {
    return false;
  }
  try {
    const proc = Bun.spawn(command, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    proc.stdin.write(input);
    proc.stdin.end();
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

async function run(command: string[]): Promise<boolean> {
  if (!hasBunRuntime) {
    return false;
  }
  try {
    const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

async function copyDarwin(text: string, logger?: Logger): Promise<boolean> {
  if (commandExists("pbcopy")) {
    const ok = await runWithInput(["pbcopy"], text);
    if (ok) return true;
  }
  if (commandExists("osascript")) {
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `set the clipboard to "${escaped}"`;
    const ok = await run(["osascript", "-e", script]);
    if (ok) return true;
  }
  logger?.debug("clipboard: no macOS copy method available");
  return false;
}

async function copyLinux(text: string, logger?: Logger): Promise<boolean> {
  if (process.env.WAYLAND_DISPLAY && commandExists("wl-copy")) {
    const ok = await runWithInput(["wl-copy"], text);
    if (ok) return true;
  }
  if (commandExists("xclip")) {
    const ok = await runWithInput(["xclip", "-selection", "clipboard"], text);
    if (ok) return true;
  }
  if (commandExists("xsel")) {
    const ok = await runWithInput(["xsel", "--clipboard", "--input"], text);
    if (ok) return true;
  }
  logger?.debug("clipboard: no Linux copy method available");
  return false;
}

async function copyWindows(text: string, logger?: Logger): Promise<boolean> {
  if (!commandExists("powershell")) {
    logger?.debug("clipboard: powershell not available");
    return false;
  }
  const escaped = text.replace(/'/g, "''");
  const heredoc = `@'\n${escaped}\n'@`;
  const command = `$text = ${heredoc}; Set-Clipboard -Value $text`;
  return run(["powershell", "-command", command]);
}

async function copyNative(text: string, logger?: Logger): Promise<boolean> {
  const os = platform();
  if (os === "darwin") return copyDarwin(text, logger);
  if (os === "linux") return copyLinux(text, logger);
  if (os === "win32") return copyWindows(text, logger);
  logger?.debug({ os }, "clipboard: unsupported platform for native copy");
  return false;
}

export async function copyTextToClipboard(
  text: string,
  options?: { renderer?: unknown; logger?: Logger },
): Promise<boolean> {
  if (!text) {
    return false;
  }
  const oscSent = sendOsc52(text, options?.renderer, options?.logger);
  const nativeCopied = await copyNative(text, options?.logger).catch((err) => {
    options?.logger?.warn({ err }, "clipboard: native copy failed");
    return false;
  });
  return oscSent || nativeCopied;
}
