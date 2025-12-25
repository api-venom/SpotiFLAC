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
import { buildLrcTimeline, findActiveIndex, getLineProgress, formatEllipsisDots } from "@/lib/lyrics/lrc";
import { buildPaletteBackgroundStyle } from "@/lib/cover/palette";
import { useCoverPalette } from "@/hooks/useCoverPalette";

export interface LyricsOverlayTrack {
  spotify_id: string;
  name: string;
  artists: string;
  coverUrl?: string;
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
  const palette = useCoverPalette(track?.coverUrl);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [fetching, setFetching] = useState(false);
  const [dotCount, setDotCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLyricsRef = useRef<HTMLDivElement>(null);

  const timeline = useMemo(() => buildLrcTimeline(content), [content]);

  // Animated dots for instrumental breaks
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Find the current active line
  const activeIndex = useMemo(() => {
    return findActiveIndex(timeline, currentPosition, 0.1);
  }, [timeline, currentPosition]);

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
    return getLineProgress(timeline, activeIndex, currentPosition);
  }, [activeIndex, timeline, currentPosition]);

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

  const dots = formatEllipsisDots(dotCount);
  const bgStyle = useMemo(() => buildPaletteBackgroundStyle(palette), [palette]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="relative p-0 gap-0 max-w-none w-screen h-[100dvh] rounded-none border-0 text-white overflow-hidden" style={bgStyle}>
        {/* Animated palette blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className={cn(
              "absolute -top-40 -left-40 w-96 h-96 rounded-full blur-3xl opacity-20",
              "animate-[pulse_8s_ease-in-out_infinite]"
            )}
            style={{ backgroundColor: palette?.vibrant || "rgba(100, 100, 200, 0.3)" }}
          />
          <div
            className={cn(
              "absolute top-1/3 -right-40 w-80 h-80 rounded-full blur-3xl opacity-15",
              "animate-[pulse_12s_ease-in-out_infinite]"
            )}
            style={{ backgroundColor: palette?.dominant || "rgba(150, 100, 150, 0.3)" }}
          />
          <div
            className={cn(
              "absolute -bottom-40 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-10",
              "animate-[pulse_10s_ease-in-out_infinite]"
            )}
            style={{ backgroundColor: palette?.light || "rgba(200, 150, 100, 0.3)" }}
          />
        </div>

        {/* Backdrop blur overlay */}
        <div className="absolute inset-0 backdrop-blur-3xl bg-black/30" />

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
          className="relative px-6 pb-8 overflow-y-auto overflow-x-hidden flex-1 scroll-smooth"
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
              {timeline.map((l, idx) => {
                const isActive = idx === activeIndex;
                const isNext = idx === activeIndex + 1;
                const isPast = idx < activeIndex;
                const isFuture = idx > activeIndex + 1;
                const progress = lineProgress[idx] || 0;
                
                const isEllipsis = l.kind === "ellipsis";
                const displayText = isEllipsis ? (isActive && isPlaying ? dots : "...") : l.text;
                
                return (
                  <div
                    key={`${idx}-${l.t}`}
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
