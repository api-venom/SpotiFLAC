export type LogLevel = "info" | "success" | "warning" | "error" | "debug";

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  source?: "ui" | "api" | "player" | "backend" | "system";
}

function safeToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ""}`;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 3000;
  private listeners: Set<() => void> = new Set();

  private addLog(level: LogLevel, message: string, source?: LogEntry["source"]) {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      // keep original casing; don’t destroy URLs and IDs
      message,
      source,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.splice(0, this.logs.length - this.maxLogs);
    }
    this.notifyListeners();
  }

  info(message: string, source?: LogEntry["source"]) {
    this.addLog("info", message, source);
  }

  success(message: string, source?: LogEntry["source"]) {
    this.addLog("success", message, source);
  }

  warning(message: string, source?: LogEntry["source"]) {
    this.addLog("warning", message, source);
  }

  error(message: string, source?: LogEntry["source"]) {
    this.addLog("error", message, source);
  }

  debug(message: string, source?: LogEntry["source"]) {
    this.addLog("debug", message, source);
  }

  exception(err: unknown, context?: string, source?: LogEntry["source"]) {
    const msg = context ? `${context}\n${safeToString(err)}` : safeToString(err);
    this.addLog("error", msg, source);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
    this.notifyListeners();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => listener());
  }
}

export const logger = new Logger();
