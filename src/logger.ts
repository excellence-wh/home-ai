// 简化版彩色 logger（源：archive/home_ai/logger.py 的 ColorFormatter）
const COLORS: Record<string, string> = {
  DEBUG: "\x1b[36m",
  INFO: "\x1b[32m",
  WARNING: "\x1b[33m",
  ERROR: "\x1b[31m",
  CRITICAL: "\x1b[1;31m",
  RESET: "\x1b[0m",
};

type Level = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
const LEVEL_ORDER: Record<Level, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
};

function resolveLevel(name: string): Level {
  const n = (name || "INFO").toUpperCase();
  if (!(n in LEVEL_ORDER)) throw new Error(`无效的日志级别: ${name}, 可选值为 DEBUG, INFO, WARNING, ERROR, CRITICAL`);
  return n as Level;
}

const globalLevel: Level = resolveLevel(process.env.MIJIA_LOG_LEVEL ?? "INFO");

function fmtLine(level: Level, message: string): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
  const color = process.stdout.isTTY ? COLORS[level] : "";
  const reset = process.stdout.isTTY ? COLORS.RESET : "";
  return `${color}${ts} - mijiaAPI - ${level}: ${message}${reset}`;
}

function log(level: Level, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[globalLevel]) return;
  if (level === "ERROR" || level === "CRITICAL") {
    console.error(fmtLine(level, message));
  } else {
    console.log(fmtLine(level, message));
  }
}

export const logger = {
  debug: (m: string) => log("DEBUG", m),
  info: (m: string) => log("INFO", m),
  warning: (m: string) => log("WARNING", m),
  error: (m: string) => log("ERROR", m),
  critical: (m: string) => log("CRITICAL", m),
};
