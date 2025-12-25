import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
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

  // Get visible lines (previous, current, next 2-3 lines)
  const visibleLines = useMemo(() => {
    const lines = [];
    const start = Math.max(0, activeIndex - 1);
    const end = Math.min(timeline.length, activeIndex + 4);
    
    for (let i = start; i < end; i++) {
      const line = timeline[i];
      if (!line) continue;
      
      const isEllipsis = line.kind === "ellipsis";
      const displayText = isEllipsis ? (isPlaying ? dots : "") : line.text;
      
      // Skip empty ellipsis
      if (isEllipsis && !displayText) continue;
      
      lines.push({
        text: displayText,
        index: i,
        isActive: i === activeIndex,
        isPast: i < activeIndex,
        progress: lineProgress[i] || 0,
      });
    }
    
    return lines;
  }, [timeline, activeIndex, isPlaying, dots, lineProgress]);

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

        {/* Header with close button */}
        <div className="absolute top-6 right-6 z-10">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-full"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Main Content - Side by Side Layout */}
        <div className="relative h-full flex items-center justify-center p-8 md:p-12">
          <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            
            {/* Left Side - Album Art & Track Info */}
            <div className="flex flex-col items-center lg:items-start gap-6">
              {/* Album Art */}
              <div className="relative w-full max-w-sm lg:max-w-md aspect-square">
                {track?.coverUrl ? (
                  <img
                    src={track.coverUrl}
                    alt={track.name}
                    className="w-full h-full object-cover rounded-2xl shadow-2xl"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-white/5 to-white/10 rounded-2xl flex items-center justify-center">
                    <div className="text-6xl text-white/20">♫</div>
                  </div>
                )}
              </div>
              
              {/* Track Info */}
              <div className="w-full max-w-sm lg:max-w-md text-center lg:text-left">
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-2 truncate">
                  {track?.name || "Lyrics"}
                </h1>
                <h2 className="text-lg md:text-xl lg:text-2xl text-white/70 truncate">
                  {track?.artists}
                </h2>
                {track && (
                  <p className="text-sm text-white/50 mt-4">
                    My Dear Melancholy,
                  </p>
                )}
              </div>
            </div>

            {/* Right Side - Lyrics (Centered, One at a Time) */}
            <div className="flex flex-col items-center justify-center h-full space-y-8 px-4">
              {loading || fetching ? (
                <div className="text-center text-white/60 text-xl">
                  {fetching ? "Fetching lyrics..." : "Loading lyrics…"}
                </div>
              ) : error ? (
                <div className="text-center text-white/60 text-xl">{error}</div>
              ) : (
                <>
                  {visibleLines.map((line, idx) => {
                    // Show bullet for past lines
                    const showBullet = line.isPast && idx === 0;
                    
                    return (
                      <div
                        key={line.index}
                        className={cn(
                          "relative transition-all duration-500 ease-out text-center w-full",
                          line.isActive && "scale-100",
                          !line.isActive && "scale-90"
                        )}
                      >
                        {/* Bullet for previous line */}
                        {showBullet && (
                          <div className="text-center mb-6 text-white/40 text-4xl">
                            •
                          </div>
                        )}
                        
                        {/* Background text (gray for future, dimmed for past) */}
                        <div
                          className={cn(
                            "transition-all duration-500 font-bold leading-tight px-4",
                            line.isActive && "text-4xl sm:text-5xl md:text-6xl lg:text-7xl",
                            !line.isActive && "text-2xl sm:text-3xl md:text-4xl"
                          )}
                          style={{
                            color: line.isPast ? "#888" : line.isActive ? "#999" : "#666",
                            opacity: line.isPast ? 0.5 : !line.isActive ? 0.6 : 1,
                          }}
                        >
                          {line.text}
                        </div>
                        
                        {/* Foreground text (white) with smooth fill animation for active line */}
                        {line.isActive && line.progress > 0 && (
                          <div
                            className="absolute inset-0 overflow-hidden transition-all duration-150"
                            style={{
                              clipPath: `inset(0 ${(1 - line.progress) * 100}% 0 0)`,
                            }}
                          >
                            <div
                              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-tight px-4"
                              style={{
                                color: "#FFFFFF",
                                textShadow: "0 2px 20px rgba(255,255,255,0.5), 0 0 40px rgba(255,255,255,0.3)",
                              }}
                            >
                              {line.text}
                            </div>
                          </div>
                        )}
                        
                        {/* Past lines shown in white with reduced opacity */}
                        {line.isPast && (
                          <div className="absolute inset-0">
                            <div
                              className="text-2xl sm:text-3xl md:text-4xl font-bold leading-tight px-4"
                              style={{
                                color: "#FFFFFF",
                                opacity: 0.6,
                              }}
                            >
                              {line.text}
                            </div>
                          </div>
                        )}
                        
                        {/* Bullet for current line with upcoming lines */}
                        {!line.isActive && !line.isPast && idx > 0 && (
                          <div className="text-center my-4 text-white/30 text-2xl">
                            •
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
