import { useEffect, useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X, MoreHorizontal, Loader2 } from "lucide-react";
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

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

  // Calculate progress for current line
  const lineProgress = useMemo(() => {
    return getLineProgress(timeline, activeIndex, currentPosition);
  }, [activeIndex, timeline, currentPosition]);

  // Auto-scroll to active line
  useEffect(() => {
    if (activeLineRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const activeLine = activeLineRef.current;

      const containerRect = container.getBoundingClientRect();
      const lineRect = activeLine.getBoundingClientRect();

      // Calculate the offset to center the active line
      const scrollTarget = activeLine.offsetTop - container.offsetTop - (containerRect.height / 2) + (lineRect.height / 2);

      container.scrollTo({
        top: scrollTarget,
        behavior: "smooth"
      });
    }
  }, [activeIndex]);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 text-white overflow-hidden" style={bgStyle}>
      {/* Animated palette blobs - more subtle */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full blur-[120px] opacity-30 animate-[pulse_10s_ease-in-out_infinite]"
          style={{ backgroundColor: palette?.vibrant || "rgba(100, 100, 200, 0.3)" }}
        />
        <div
          className="absolute top-1/4 -right-40 w-[400px] h-[400px] rounded-full blur-[100px] opacity-20 animate-[pulse_14s_ease-in-out_infinite]"
          style={{ backgroundColor: palette?.dominant || "rgba(150, 100, 150, 0.3)" }}
        />
        <div
          className="absolute -bottom-40 left-1/3 w-[450px] h-[450px] rounded-full blur-[120px] opacity-15 animate-[pulse_12s_ease-in-out_infinite]"
          style={{ backgroundColor: palette?.light || "rgba(200, 150, 100, 0.3)" }}
        />
      </div>

      {/* Backdrop blur overlay - darker for better text readability */}
      <div className="absolute inset-0 backdrop-blur-3xl bg-black/50" />

      {/* Header with close and menu buttons */}
      <div className="absolute top-0 left-0 right-0 z-10 px-6 py-5 flex items-center justify-between bg-gradient-to-b from-black/30 to-transparent">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          className="bg-white/10 hover:bg-white/20 text-white border-0 rounded-full w-10 h-10 backdrop-blur-sm"
        >
          <X className="h-5 w-5" />
        </Button>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowMenu(!showMenu)}
            className="bg-white/10 hover:bg-white/20 text-white border-0 rounded-full w-10 h-10 backdrop-blur-sm"
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 z-50 animate-in fade-in-0 slide-in-from-top-2 duration-200">
              <EqualizerControls useMPV={state.useMPV} />
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="relative h-full flex items-stretch p-8 pt-20">
        <div className="w-full h-full flex gap-10 lg:gap-16">

          {/* Left Side - Album Art & Track Info */}
          <div className="flex-shrink-0 w-80 flex flex-col justify-center">
            {/* Album Art */}
            <div className="relative group">
              <div className="absolute -inset-2 bg-white/5 rounded-2xl blur-xl opacity-50" />
              {track?.coverUrl ? (
                <img
                  src={track.coverUrl}
                  alt={track.name}
                  className="relative w-full aspect-square object-cover rounded-xl shadow-2xl ring-1 ring-white/10"
                />
              ) : (
                <div className="relative w-full aspect-square bg-gradient-to-br from-white/10 to-white/5 rounded-xl flex items-center justify-center ring-1 ring-white/10">
                  <div className="text-6xl text-white/20">♫</div>
                </div>
              )}
            </div>

            {/* Track Info */}
            <div className="mt-8">
              <h1 className="text-2xl font-bold text-white leading-tight line-clamp-2">
                {track?.name}
              </h1>
              <h2 className="text-lg text-white/60 mt-2 line-clamp-1">
                {track?.artists}
              </h2>
            </div>
          </div>

          {/* Right Side - Lyrics Area */}
          <div
            ref={scrollContainerRef}
            className="flex-1 flex flex-col justify-center overflow-y-auto scrollbar-hide min-w-0 py-20"
          >
            {loading || fetching ? (
              <div className="flex items-center justify-center gap-3 text-white/50">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xl">{fetching ? "Fetching lyrics..." : "Loading lyrics..."}</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center text-white/40">
                <span className="text-6xl mb-4">♪</span>
                <span className="text-xl">{error}</span>
              </div>
            ) : (
              <div className="space-y-3 px-4">
                {timeline.map((line, index) => {
                  const isActive = index === activeIndex;
                  const isPast = index < activeIndex;
                  const isEllipsis = line.kind === "ellipsis";
                  const progress = lineProgress[index] || 0;

                  // Skip ellipsis lines completely for cleaner look
                  if (isEllipsis) {
                    return null;
                  }

                  return (
                    <div
                      key={index}
                      ref={isActive ? activeLineRef : undefined}
                      className={cn(
                        "relative transition-all duration-500 ease-out",
                        isActive && "scale-[1.02]"
                      )}
                    >
                      <div
                        className="relative inline-block w-full"
                        style={{
                          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                          fontWeight: isActive ? 700 : 600,
                          fontSize: isActive ? "clamp(1.75rem, 3.5vw, 2.75rem)" : "clamp(1.5rem, 3vw, 2.25rem)",
                          lineHeight: 1.35,
                          letterSpacing: "-0.02em",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          WebkitFontSmoothing: "antialiased",
                          MozOsxFontSmoothing: "grayscale",
                        }}
                      >
                        {/* Background text layer */}
                        <span
                          style={{
                            color: isPast
                              ? "rgba(255, 255, 255, 0.45)"
                              : isActive
                                ? "rgba(255, 255, 255, 0.4)"
                                : "rgba(255, 255, 255, 0.25)",
                          }}
                        >
                          {line.text}
                        </span>

                        {/* Active line fill animation */}
                        {isActive && progress > 0 && (
                          <span
                            className="absolute inset-0 overflow-hidden"
                            style={{
                              clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
                            }}
                          >
                            <span style={{ color: "#FFFFFF" }}>
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
