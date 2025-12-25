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

  // Auto-scroll - position active line in upper third of screen (like image 2)
  useEffect(() => {
    if (activeIndex >= 0 && activeLyricsRef.current && containerRef.current) {
      const container = containerRef.current;
      const activeElement = activeLyricsRef.current;
      
      const containerHeight = container.clientHeight;
      const elementTop = activeElement.offsetTop;
      
      // Position active line in upper third (similar to image 2)
      const scrollTop = elementTop - (containerHeight / 3);
      
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
            <div className="max-w-4xl mx-auto py-[33vh] px-8">
              {timeline.map((l, idx) => {
                const isActive = idx === activeIndex;
                const isPast = idx < activeIndex;
                const isFuture = idx > activeIndex;
                const progress = lineProgress[idx] || 0;
                
                const isEllipsis = l.kind === "ellipsis";
                const displayText = isEllipsis ? (isPlaying ? dots : "") : l.text;
                
                // Hide ellipsis lines if empty
                if (isEllipsis && !displayText) return null;
                
                return (
                  <div
                    key={`${idx}-${l.t}`}
                    ref={isActive ? activeLyricsRef : null}
                    className={cn(
                      "relative transition-all duration-500 ease-out",
                      isActive && "mb-4 text-4xl md:text-5xl lg:text-6xl",
                      !isActive && "mb-2 text-2xl md:text-3xl lg:text-4xl",
                      "font-bold leading-tight"
                    )}
                  >
                    {/* Background text (gray for future, dimmed for past) */}
                    <div
                      className={cn(
                        "transition-all duration-500 break-words"
                      )}
                      style={{
                        color: isPast ? "#888" : isFuture ? "#666" : "#999",
                        opacity: isPast ? 0.4 : isFuture ? 0.5 : 1,
                        wordBreak: "break-word",
                        overflowWrap: "break-word",
                      }}
                    >
                      {displayText}
                    </div>
                    
                    {/* Foreground text (white) with smooth fill animation for active line */}
                    {isActive && progress > 0 && (
                      <div
                        className="absolute inset-0 overflow-hidden transition-all duration-150"
                        style={{
                          clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
                        }}
                      >
                        <div
                          className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight break-words"
                          style={{
                            color: "#FFFFFF",
                            textShadow: "0 2px 20px rgba(255,255,255,0.5), 0 0 40px rgba(255,255,255,0.3)",
                            wordBreak: "break-word",
                            overflowWrap: "break-word",
                          }}
                        >
                          {displayText}
                        </div>
                      </div>
                    )}
                    
                    {/* Past lines shown in white with reduced opacity */}
                    {isPast && (
                      <div className="absolute inset-0">
                        <div
                          className="text-2xl md:text-3xl lg:text-4xl font-bold leading-tight break-words"
                          style={{
                            color: "#FFFFFF",
                            opacity: 0.6,
                            wordBreak: "break-word",
                            overflowWrap: "break-word",
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
