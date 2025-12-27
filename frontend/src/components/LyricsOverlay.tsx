import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X, MoreHorizontal } from "lucide-react";
import { ReadTextFile } from "../../wailsjs/go/main/App";
import { buildLrcTimeline, findActiveIndex, getLineProgress } from "@/lib/lyrics/lrc";
import { buildPaletteBackgroundStyle } from "@/lib/cover/palette";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { EqualizerControls } from "./EqualizerControls";
import { usePlayer } from "@/hooks/usePlayer";

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
}: LyricsOverlayProps) {
  const palette = useCoverPalette(track?.coverUrl);
  const { state } = usePlayer();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [fetching, setFetching] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const timeline = useMemo(() => buildLrcTimeline(content), [content]);

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

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showMenu) setShowMenu(false);
    };

    if (showMenu) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [showMenu]);

  const bgStyle = useMemo(() => buildPaletteBackgroundStyle(palette), [palette]);

  // Get visible lines - Skip ellipsis completely, show only lyrics
  const visibleLines = useMemo(() => {
    const lines = [];
    const start = Math.max(0, activeIndex - 2);
    const end = Math.min(timeline.length, activeIndex + 6);
    
    for (let i = start; i < end; i++) {
      const line = timeline[i];
      if (!line) continue;
      
      const isEllipsis = line.kind === "ellipsis";
      const isLineActive = i === activeIndex;
      
      // Skip ellipsis completely - don't show three dots
      if (isEllipsis) {
        continue;
      }
      
      lines.push({
        text: line.text,
        index: i,
        isActive: isLineActive,
        isPast: i < activeIndex,
        isEllipsis: false,
        progress: lineProgress[i] || 0,
      });
    }
    
    return lines;
  }, [timeline, activeIndex, lineProgress]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 text-white overflow-hidden" style={bgStyle}>
      {/* Animated palette blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -left-40 w-96 h-96 rounded-full blur-3xl opacity-20 animate-[pulse_8s_ease-in-out_infinite]"
          style={{ backgroundColor: palette?.vibrant || "rgba(100, 100, 200, 0.3)" }}
        />
        <div
          className="absolute top-1/3 -right-40 w-80 h-80 rounded-full blur-3xl opacity-15 animate-[pulse_12s_ease-in-out_infinite]"
          style={{ backgroundColor: palette?.dominant || "rgba(150, 100, 150, 0.3)" }}
        />
        <div
          className="absolute -bottom-40 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-10 animate-[pulse_10s_ease-in-out_infinite]"
          style={{ backgroundColor: palette?.light || "rgba(200, 150, 100, 0.3)" }}
        />
      </div>

      {/* Backdrop blur overlay */}
      <div className="absolute inset-0 backdrop-blur-3xl bg-black/40" />

      {/* Header with close and menu buttons */}
      <div className="absolute top-6 left-6 right-6 z-10 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          className="bg-white/10 hover:bg-white/20 text-white border-0 rounded-full w-10 h-10"
        >
          <X className="h-5 w-5" />
        </Button>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowMenu(!showMenu)}
            className="bg-white/10 hover:bg-white/20 text-white border-0 rounded-full w-10 h-10"
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-black/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl p-4 z-50 animate-in fade-in-0 slide-in-from-top-2 duration-200">
              <EqualizerControls useMPV={state.useMPV} />
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="relative h-full flex items-center p-8 md:p-12">
        <div className="w-full h-full flex items-stretch gap-8 lg:gap-12">
          
          {/* Left Side - Compact Album Art */}
          <div className="flex-shrink-0 w-72 flex flex-col justify-center">
            {track?.coverUrl ? (
              <img
                src={track.coverUrl}
                alt={track.name}
                className="w-full aspect-square object-cover rounded-xl shadow-2xl"
              />
            ) : (
              <div className="w-full aspect-square bg-gradient-to-br from-white/5 to-white/10 rounded-xl flex items-center justify-center">
                <div className="text-6xl text-white/20">♫</div>
              </div>
            )}
            
            {/* Track Info */}
            <div className="mt-6">
              <h1 className="text-xl font-bold text-white mb-1 line-clamp-2">
                {track?.name}
              </h1>
              <h2 className="text-base text-white/70 line-clamp-1">
                {track?.artists}
              </h2>
              <p className="text-sm text-white/50 mt-2">
                My Dear Melancholy,
              </p>
            </div>
          </div>

          {/* Right Side - Large Centered Lyrics Area */}
          <div className="flex-1 flex flex-col items-center justify-center min-w-0">
            {loading || fetching ? (
              <div className="text-center text-white/60 text-xl">
                {fetching ? "Fetching lyrics..." : "Loading lyrics…"}
              </div>
            ) : error ? (
              <div className="text-center text-white/60 text-xl">{error}</div>
            ) : (
              <div className="w-full max-w-7xl space-y-4">
                {visibleLines.map((line) => {
                  return (
                    <div
                      key={line.index}
                      className={cn(
                        "relative text-center w-full transition-all duration-500 ease-out",
                        line.isActive ? "scale-110" : "scale-100"
                      )}
                    >
                      {/* Base text layer */}
                      <div
                        className="relative inline-block max-w-full px-6"
                        style={{
                          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                          fontWeight: 700,
                          fontSize: "clamp(2rem, 4vw, 3.5rem)",
                          lineHeight: 1.3,
                          letterSpacing: "-0.01em",
                          WebkitFontSmoothing: "antialiased",
                          MozOsxFontSmoothing: "grayscale",
                          textRendering: "optimizeLegibility",
                        }}
                      >
                        {/* Background text */}
                        <span
                          style={{
                            color: line.isPast ? "#FFFFFF" : line.isActive ? "#999999" : "#666666",
                            opacity: line.isPast ? 0.35 : line.isActive ? 1 : 0.45,
                            transition: "all 500ms cubic-bezier(0.4, 0, 0.2, 1)",
                          }}
                        >
                          {line.text}
                        </span>
                        
                        {/* White fill animation overlay for active line */}
                        {line.isActive && line.progress > 0 && (
                          <span
                            className="absolute inset-0 overflow-hidden"
                            style={{
                              clipPath: `inset(0 ${(1 - line.progress) * 100}% 0 0)`,
                              transition: "clip-path 100ms linear",
                            }}
                          >
                            <span
                              style={{
                                color: "#FFFFFF",
                                textShadow: "0 0 40px rgba(255,255,255,0.5)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {line.text}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
