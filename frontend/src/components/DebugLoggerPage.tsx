import { useMemo, useState, useEffect, useRef } from "react";
import { Trash2, Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logger, type LogEntry, type LogLevel } from "@/lib/logger";

const levelColors: Record<string, string> = {
  info: "text-blue-500",
  success: "text-green-500",
  warning: "text-yellow-500",
  error: "text-red-500",
  debug: "text-gray-500",
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function serializeLogs(logs: LogEntry[]) {
  return logs
    .map((log) => {
      const src = log.source ? ` [${log.source}]` : "";
      return `[${formatTime(log.timestamp)}] [${log.level}]${src} ${log.message}`;
    })
    .join("\n");
}

export function DebugLoggerPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [minLevel, setMinLevel] = useState<LogLevel | "all">("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = logger.subscribe(() => {
      setLogs(logger.getLogs());
    });
    setLogs(logger.getLogs());
    return () => {
      unsubscribe();
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const allowedLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      success: 1,
      warning: 2,
      error: 3,
    };

    return logs.filter((l) => {
      if (minLevel !== "all" && allowedLevel[l.level] < allowedLevel[minLevel]) return false;
      if (!q) return true;
      return (
        l.message.toLowerCase().includes(q) ||
        (l.source ? l.source.toLowerCase().includes(q) : false) ||
        l.level.toLowerCase().includes(q)
      );
    });
  }, [logs, query, minLevel]);

  useEffect(() => {
    if (!autoScroll) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const handleClear = () => {
    logger.clear();
  };

  const handleCopy = async () => {
    const logText = serializeLogs(filtered);

    try {
      await navigator.clipboard.writeText(logText);
      setCopied(true);
      setTimeout(() => setCopied(false), 500);
    } catch (err) {
      console.error("Failed to copy logs:", err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([serializeLogs(filtered)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spotiflac-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Debug Logs</h1>
          <p className="text-sm text-muted-foreground">Search, filter, copy, download. Keeps up to 3000 entries.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter logs... (error, spotify, stream, URL, etc)"
            className="w-[280px]"
          />

          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value as LogLevel | "all")}
          >
            <option value="all">All levels</option>
            <option value="debug">Debug+</option>
            <option value="info">Info+</option>
            <option value="warning">Warning+</option>
            <option value="error">Error only</option>
          </select>

          <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleCopy}
            disabled={filtered.length === 0}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleDownload}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" />
            Download
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleClear}
            disabled={logs.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>
          Showing <span className="text-foreground">{filtered.length}</span> / {logs.length} lines
        </div>
      </div>

      <div
        ref={scrollRef}
        className="h-[calc(100vh-260px)] overflow-y-auto bg-muted/50 rounded-lg p-4 font-mono text-xs"
      >
        {filtered.length === 0 ? (
          <p className="text-muted-foreground">No logs match.</p>
        ) : (
          filtered.map((log, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="text-muted-foreground shrink-0">[{formatTime(log.timestamp)}]</span>
              <span className={`shrink-0 w-16 ${levelColors[log.level]}`}>[{log.level}]</span>
              <span className="text-muted-foreground shrink-0 w-20">{log.source ? `[${log.source}]` : ""}</span>
              <span className="break-all whitespace-pre-wrap">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
