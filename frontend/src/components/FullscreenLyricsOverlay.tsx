import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { X, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

type FullscreenLyricsOverlayProps = {
  track: {
    name: string;
    artists: string;
    images?: string;
    album_name?: string;
    spotify_id?: string;
  };
  lyricsFilePath: string | null;
  onClose: () => void;
};

type ParsedLyricLine = {
  ms: number | null;
  text: string;
  isPause: boolean;
};

const READ_TEXT_FILE = (path: string): Promise<string> =>
  (window as any)["go"]["main"]["App"]["ReadTextFile"](path);

function parseLrc(content: string, includePauseMarkers: boolean): ParsedLyricLine[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  const parsed: ParsedLyricLine[] = [];
  const timeTag = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      // Blank line → treat as a pause marker (instrumental / gap).
      if (includePauseMarkers) {
        parsed.push({ ms: null, text: "…", isPause: true });
      }
      continue;
    }

    const matches = [...line.matchAll(timeTag)];
    const text = line.replace(timeTag, "").trim();

    // No time tags → plain lyric.
    if (matches.length === 0) {
      parsed.push({ ms: null, text: text || "…", isPause: !text });
      continue;
    }

    for (const m of matches) {
      const minutes = Number(m[1] ?? 0);
      const seconds = Number(m[2] ?? 0);
      const fraction = m[3] ?? "0";
      const msFraction = Number(fraction.padEnd(3, "0").slice(0, 3));
      const ms = minutes * 60_000 + seconds * 1_000 + msFraction;

      const isPause = !text;
      parsed.push({ ms, text: text || "…", isPause });
    }
  }

  // If everything is unsynced, keep order.
  const hasAnyTimestamp = parsed.some((l) => typeof l.ms === "number");
  const sorted = hasAnyTimestamp
    ? [...parsed].sort((a, b) => (a.ms ?? Number.MAX_SAFE_INTEGER) - (b.ms ?? Number.MAX_SAFE_INTEGER))
    : parsed;

  if (!includePauseMarkers || !hasAnyTimestamp) return sorted;

  // Insert explicit pause markers when there are large gaps between timestamps.
  const withGaps: ParsedLyricLine[] = [];
  const GAP_MS = 5000;

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    withGaps.push(current);

    const next = sorted[i + 1];
    if (!next) continue;

    if (current.ms != null && next.ms != null) {
      const gap = next.ms - current.ms;
      if (gap >= GAP_MS) {
        withGaps.push({ ms: current.ms + Math.floor(gap / 2), text: "…", isPause: true });
      }
    }
  }

  return withGaps;
}

export function FullscreenLyricsOverlay({ track, lyricsFilePath, onClose }: FullscreenLyricsOverlayProps) {
  const [rawLyrics, setRawLyrics] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showChrome, setShowChrome] = useState(true);
  const hideTimerRef = useRef<number | null>(null);

  const [showOptions, setShowOptions] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [showPauseMarkers, setShowPauseMarkers] = useState(true);
  const [alwaysShowTopBar, setAlwaysShowTopBar] = useState(false);

  const parsedLines = useMemo(() => {
    if (!rawLyrics) return [];
    return parseLrc(rawLyrics, showPauseMarkers);
  }, [rawLyrics, showPauseMarkers]);

  useEffect(() => {
    if (!lyricsFilePath) {
      setRawLyrics("");
      setLoadError("No lyrics file found for this track.");
      return;
    }

    let cancelled = false;
    setLoadError(null);

    READ_TEXT_FILE(lyricsFilePath)
      .then((txt) => {
        if (cancelled) return;
        setRawLyrics(txt ?? "");
        if (!txt?.trim()) setLoadError("Lyrics file is empty.");
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to read lyrics file");
      });

    return () => {
      cancelled = true;
    };
  }, [lyricsFilePath]);

  useEffect(() => {
    const scheduleHide = () => {
      if (alwaysShowTopBar) return;
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => setShowChrome(false), 2500);
    };

    const onActivity = () => {
      setShowChrome(true);
      scheduleHide();
    };

    scheduleHide();
    window.addEventListener("mousemove", onActivity);
    window.addEventListener("keydown", onActivity);

    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [alwaysShowTopBar]);

  return (
    <div className="fixed inset-0 z-[100] bg-background">
      {/* Top bar (auto-hides on standby) */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-14 px-4 flex items-center justify-between border-b bg-background/70 backdrop-blur-md transition-opacity",
          showChrome || alwaysShowTopBar ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground truncate">{track.artists}</div>
          <div className="font-medium truncate">{track.name}</div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setShowOptions(true)} aria-label="Lyrics options">
            <MoreHorizontal className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close fullscreen lyrics">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="pt-14 h-full">
        <div className="h-full grid grid-cols-1 md:grid-cols-2">
          {/* Cover */}
          <div className="p-6 md:p-10 flex items-center justify-center border-b md:border-b-0 md:border-r">
            {track.images ? (
              <img
                src={track.images}
                alt={track.name}
                className="w-[280px] h-[280px] md:w-[420px] md:h-[420px] rounded-xl object-cover"
              />
            ) : (
              <div className="w-[280px] h-[280px] md:w-[420px] md:h-[420px] rounded-xl bg-muted" />
            )}
          </div>

          {/* Lyrics */}
          <div className="p-6 md:p-10 overflow-y-auto">
            {loadError ? (
              <div className="text-sm text-muted-foreground">{loadError}</div>
            ) : (
              <div className="space-y-3">
                {parsedLines.map((l, idx) => (
                  <div
                    key={`${l.ms ?? "na"}-${idx}`}
                    className={cn(
                      "text-xl md:text-2xl leading-snug",
                      l.isPause ? "text-muted-foreground text-center" : "text-foreground"
                    )}
                  >
                    {showTimestamps && l.ms != null && (
                      <span className="mr-3 text-xs text-muted-foreground align-middle">
                        {Math.floor(l.ms / 60000)}:{Math.floor((l.ms % 60000) / 1000)
                          .toString()
                          .padStart(2, "0")}
                      </span>
                    )}
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Options dialog (3-dots) */}
      <Dialog open={showOptions} onOpenChange={setShowOptions}>
        <DialogContent className="sm:max-w-[420px] p-6 [&>button]:hidden">
          <DialogTitle className="text-sm font-medium">Lyrics Options</DialogTitle>
          <DialogDescription>Control how lyrics are displayed in fullscreen.</DialogDescription>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <Checkbox id="show-timestamps" checked={showTimestamps} onCheckedChange={(v) => setShowTimestamps(Boolean(v))} />
              <Label htmlFor="show-timestamps" className="cursor-pointer text-sm">
                Show timestamps
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox id="show-pauses" checked={showPauseMarkers} onCheckedChange={(v) => setShowPauseMarkers(Boolean(v))} />
              <Label htmlFor="show-pauses" className="cursor-pointer text-sm">
                Show pauses as …
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox id="always-top" checked={alwaysShowTopBar} onCheckedChange={(v) => setAlwaysShowTopBar(Boolean(v))} />
              <Label htmlFor="always-top" className="cursor-pointer text-sm">
                Always show top bar
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOptions(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
