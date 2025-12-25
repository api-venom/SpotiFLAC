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
  currentPosition: number;
  fetchLyrics?: (spotifyId: string, trackName: string, artistName: string) => Promise<void>;
  isPlaying?: boolean;
}

export function LyricsOverlay({
  open,
  onOpenChange,
  track,
  ensureLyricsFile,
  currentPosition,
  fetchLyrics,
  isPlaying = true,
}: LyricsOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [fetching, setFetching] = useState(false);
  const [dotCount, setDotCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLyricsRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseLRC(content), [content]);

  // Animated dots for instrumental breaks
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Find the current active line
  const activeIndex = useMemo(() => {
    if (!parsed.length) return -1;
    
    let idx = -1;
    for (let i = 0; i < parsed.length; i++) {
      if (parsed[i].t !== null && parsed[i].t! <= currentPosition + 0.1) {
        idx = i;
      } else if (parsed[i].t !== null && parsed[i].t! > currentPosition + 0.1) {
        break;
      }
    }
    return idx;
  }, [parsed, currentPosition]);

  // Auto-scroll with smoother animation and better centering
  useEffect(() => {
    if (activeIndex >= 0 && activeLyricsRef.current && containerRef.current) {
      const container = containerRef.current;
      const activeElement = activeLyricsRef.current;
      
      const containerHeight = container.clientHeight;
      const elementTop = activeElement.offsetTop;
      const elementHeight = activeElement.clientHeight;
      
      // Center the active line vertically
      const scrollTop = elementTop - (containerHeight / 2) + (elementHeight / 2);
      
      container.scrollTo({
        top: scrollTop,
        behavior: "smooth",
      });
    }
  }, [activeIndex]);

  // Calculate progress for current and next line
  const lineProgress = useMemo(() => {
    const result: Record<number, number> = {};
    
    if (activeIndex >= 0 && parsed[activeIndex]) {
      const currentLine = parsed[activeIndex];
      const nextLine = parsed[activeIndex + 1];
      
      if (currentLine.t !== null) {
        const startTime = currentLine.t;
        const endTime = nextLine?.t ?? (startTime + 3);
        const elapsed = currentPosition - startTime;
        const duration = endTime - startTime;
        
        result[activeIndex] = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1;
        
        // Pre-fill next line slightly
        if (nextLine && nextLine.t !== null) {
          const nextDuration = nextLine.t - startTime;
          result[activeIndex + 1] = nextDuration > 0 ? Math.min(0.3, Math.max(0, elapsed / nextDuration)) : 0;
        }
      }
    }
    
    return result;
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
        
        if (!filePath && fetchLyrics) {
          setFetching(true);
          try {
            await fetchLyrics(track.spotify_id, track.name, track.artists);
            filePath = await ensureLyricsFile(track.spotify_id);
          } catch (fetchErr) {
            // Ignore
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

  const dots = ".".repeat(dotCount);

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

        <div
          ref={containerRef}
          className="px-6 pb-8 overflow-y-auto overflow-x-hidden flex-1 scroll-smooth"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.3) transparent" }}
        >
          {loading || fetching ? (
            <div className="py-16 text-center text-white/60 text-xl">
              {fetching ? "Fetching lyrics..." : "Loading lyrics…"}
            </div>
          ) : error ? (
            <div className="py-16 text-center text-white/60 text-xl">{error}</div>
          ) : (
            <div className="max-w-5xl mx-auto py-[50vh] px-4">
              {parsed.map((l, idx) => {
                const isActive = idx === activeIndex;
                const isNext = idx === activeIndex + 1;
                const isPast = idx < activeIndex;
                const isFuture = idx > activeIndex + 1;
                const progress = lineProgress[idx] || 0;
                
                // Show empty line with dots for instrumental breaks
                const displayText = l.text || (isActive && isPlaying ? dots : "···");
                
                return (
                  <div
                    key={`${idx}-${l.t ?? "x"}`}
                    ref={isActive ? activeLyricsRef : null}
                    className={cn(
                      "relative transition-all duration-700 ease-out text-center",
                      isActive && "py-8 text-4xl md:text-6xl lg:text-7xl scale-100 my-4",
                      isNext && "py-6 text-3xl md:text-5xl lg:text-6xl scale-95 opacity-80 my-3",
                      (isPast || isFuture) && "py-4 text-2xl md:text-4xl lg:text-5xl scale-90 my-2",
                      "font-bold tracking-tight leading-tight"
                    )}
                  >
                    {/* Background text (gray) */}
                    <div
                      className={cn(
                        "transition-all duration-700 break-words",
                        isPast && "opacity-40",
                        isActive && "opacity-100",
                        isNext && "opacity-60",
                        isFuture && "opacity-25"
                      )}
                      style={{
                        color: isPast ? "#777" : (isActive || isNext) ? "#999" : "#666",
                        textShadow: isActive ? "0 0 30px rgba(0,0,0,0.7), 0 4px 8px rgba(0,0,0,0.5)" : "none",
                        wordBreak: "break-word",
                        overflowWrap: "break-word",
                        hyphens: "auto"
                      }}
                    >
                      {displayText}
                    </div>
                    
                    {/* Foreground text (white) with smooth fill animation */}
                    {(isActive || isNext) && progress > 0 && (
                      <div
                        className="absolute inset-0 overflow-hidden transition-all duration-150"
                        style={{
                          clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
                        }}
                      >
                        <div
                          className={cn(
                            "font-bold tracking-tight leading-tight transition-all duration-700 break-words text-center",
                            isActive && "py-8 text-4xl md:text-6xl lg:text-7xl",
                            isNext && "py-6 text-3xl md:text-5xl lg:text-6xl opacity-50"
                          )}
                          style={{
                            color: "#FFFFFF",
                            textShadow: "0 0 40px rgba(255,255,255,0.6), 0 0 20px rgba(255,255,255,0.4), 0 4px 12px rgba(255,255,255,0.3)",
                            wordBreak: "break-word",
                            overflowWrap: "break-word",
                            hyphens: "auto"
                          }}
                        >
                          {displayText}
                        </div>
                      </div>
                    )}
                    
                    {/* Past lines in white with fade */}
                    {isPast && (
                      <div className="absolute inset-0">
                        <div
                          className={cn(
                            "py-4 text-2xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight transition-all duration-700 break-words text-center"
                          )}
                          style={{
                            color: "#FFFFFF",
                            opacity: 0.5,
                            textShadow: "0 0 15px rgba(255,255,255,0.25)",
                            wordBreak: "break-word",
                            overflowWrap: "break-word",
                            hyphens: "auto"
                          }}
                        >
                          {displayText}
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
