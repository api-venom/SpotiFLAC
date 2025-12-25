import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReadTextFile } from "../../wailsjs/go/main/App";

export interface LyricsOverlayTrack {
  spotify_id: string;
  name: string;
  artists: string;
}

type ParsedLine = { t: number | null; text: string };

function parseLRC(content: string): ParsedLine[] {
  const lines = content.split(/\r?\n/);
  const out: ParsedLine[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;

    const m = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
    if (!m) {
      out.push({ t: null, text: line });
      continue;
    }

    const min = Number(m[1]);
    const sec = Number(m[2]);
    const frac = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
    const t = min * 60 + sec + frac / 1000;
    const text = (m[4] || "").trim();
    if (text) out.push({ t, text });
  }

  return out.length ? out : [{ t: null, text: content.trim() }];
}

interface LyricsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track: LyricsOverlayTrack | null;
  ensureLyricsFile: (spotifyId: string) => Promise<string | null>;
  currentPosition: number; // Current playback position in seconds
  fetchLyrics?: (spotifyId: string, trackName: string, artistName: string) => Promise<void>;
}

export function LyricsOverlay({
  open,
  onOpenChange,
  track,
  ensureLyricsFile,
  currentPosition,
  fetchLyrics,
}: LyricsOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [fetching, setFetching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLyricsRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseLRC(content), [content]);

  // Find the current active line based on playback position
  const activeIndex = useMemo(() => {
    if (!parsed.length) return -1;
    
    // Find the last line whose timestamp is <= currentPosition
    let idx = -1;
    for (let i = 0; i < parsed.length; i++) {
      if (parsed[i].t !== null && parsed[i].t! <= currentPosition) {
        idx = i;
      } else if (parsed[i].t !== null && parsed[i].t! > currentPosition) {
        break;
      }
    }
    return idx;
  }, [parsed, currentPosition]);

  // Auto-scroll to active lyrics
  useEffect(() => {
    if (activeIndex >= 0 && activeLyricsRef.current && containerRef.current) {
      const container = containerRef.current;
      const activeElement = activeLyricsRef.current;
      
      // Smooth scroll to keep active lyrics centered
      const containerHeight = container.clientHeight;
      const elementTop = activeElement.offsetTop;
      const elementHeight = activeElement.clientHeight;
      const scrollTop = elementTop - containerHeight / 2 + elementHeight / 2;
      
      container.scrollTo({
        top: scrollTop,
        behavior: "smooth",
      });
    }
  }, [activeIndex]);

  // Calculate progress for the current line (for fill animation)
  const currentLineProgress = useMemo(() => {
    if (activeIndex < 0 || !parsed[activeIndex]) return 0;
    
    const currentLine = parsed[activeIndex];
    const nextLine = parsed[activeIndex + 1];
    
    if (currentLine.t === null) return 0;
    
    const startTime = currentLine.t;
    const endTime = nextLine?.t ?? (startTime + 3); // Default 3 seconds if no next line
    
    const elapsed = currentPosition - startTime;
    const duration = endTime - startTime;
    
    if (duration <= 0) return 1;
    return Math.min(1, Math.max(0, elapsed / duration));
  }, [activeIndex, parsed, currentPosition]);

  useEffect(() => {
    if (!open || !track?.spotify_id) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setContent("");
      try {
        let filePath = await ensureLyricsFile(track.spotify_id);
        
        // If no lyrics file exists, try to fetch it
        if (!filePath && fetchLyrics) {
          setFetching(true);
          try {
            await fetchLyrics(track.spotify_id, track.name, track.artists);
            // Try again to get the file path
            filePath = await ensureLyricsFile(track.spotify_id);
          } catch (fetchErr) {
            // Ignore fetch errors, we'll show the "not available" error below
          } finally {
            setFetching(false);
          }
        }
        
        if (!filePath) {
          throw new Error("Lyrics not available for this track");
        }
        const text = await ReadTextFile(filePath);
        if (!cancelled) setContent(text || "");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load lyrics";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, track?.spotify_id, ensureLyricsFile, fetchLyrics]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-none w-screen h-[100dvh] rounded-none border-0 bg-black/95 supports-[backdrop-filter]:bg-black/90 backdrop-blur-xl">
        <DialogHeader className="px-6 pt-6 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-white">{track ? track.name : "Lyrics"}</DialogTitle>
              {track ? (
                <p className="text-sm text-white/60 truncate">{track.artists}</p>
              ) : null}
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="bg-white/10 text-white border-white/20 hover:bg-white/20">
              Close
            </Button>
          </div>
        </DialogHeader>

        <div ref={containerRef} className="px-6 pb-8 overflow-auto flex-1">
          {loading || fetching ? (
            <div className="py-16 text-center text-white/60">
              {fetching ? "Fetching lyrics..." : "Loading lyrics…"}
            </div>
          ) : error ? (
            <div className="py-16 text-center text-white/60">{error}</div>
          ) : (
            <div className="max-w-3xl mx-auto py-32">
              {parsed.map((l, idx) => {
                const isActive = idx === activeIndex;
                const isPast = idx < activeIndex;
                const isFuture = idx > activeIndex;
                
                return (
                  <div
                    key={`${idx}-${l.t ?? "x"}`}
                    ref={isActive ? activeLyricsRef : null}
                    className={cn(
                      "py-3 text-3xl md:text-5xl font-bold tracking-tight transition-all duration-300 relative",
                      isActive && "scale-105",
                      !isActive && "scale-95"
                    )}
                  >
                    {/* Background text (gray) */}
                    <div
                      className={cn(
                        "transition-opacity duration-500",
                        isPast && "opacity-40",
                        isActive && "opacity-100",
                        isFuture && "opacity-30"
                      )}
                      style={{ color: isPast ? "#666" : isFuture ? "#555" : "#888" }}
                    >
                      {l.text}
                    </div>
                    
                    {/* Foreground text (white) with fill animation */}
                    {isActive && (
                      <div
                        className="absolute inset-0 overflow-hidden"
                        style={{
                          clipPath: `inset(0 ${(1 - currentLineProgress) * 100}% 0 0)`,
                        }}
                      >
                        <div
                          className="py-3 text-3xl md:text-5xl font-bold tracking-tight"
                          style={{ color: "#FFFFFF" }}
                        >
                          {l.text}
                        </div>
                      </div>
                    )}
                    
                    {/* Past lines in white */}
                    {isPast && (
                      <div
                        className="absolute inset-0"
                      >
                        <div
                          className="py-3 text-3xl md:text-5xl font-bold tracking-tight"
                          style={{ color: "#FFFFFF", opacity: 0.5 }}
                        >
                          {l.text}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
