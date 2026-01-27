import { useMemo, useState, useRef, useEffect } from "react";
import { FileText, X, MoreHorizontal, SkipBack, SkipForward, Play, Pause, Volume2, VolumeX, Loader2, Music } from "lucide-react";
import { usePlayer } from "../hooks/usePlayer";
import { Button } from "./ui/button";
import { useLyrics } from "../hooks/useLyrics";
import { cn } from "@/lib/utils";
import { buildPaletteBackgroundStyle } from "@/lib/cover/palette";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { EqualizerControls } from "./EqualizerControls";
import { ReadTextFile } from "../../wailsjs/go/main/App";
import { buildLrcTimeline, findActiveIndex, getLineProgress } from "@/lib/lyrics/lrc";
import type { WordTimeline } from "@/lib/lyrics/wordLyrics";
import { findActiveLineIndex, getWordProgress } from "@/lib/lyrics/wordLyrics";
import { WindowFullscreen, WindowUnfullscreen } from "../../wailsjs/runtime/runtime";

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

type LyricsState = "idle" | "loading" | "fetching" | "loaded" | "error" | "no-lyrics";

export function FullScreenPlayer() {
  const { state, player } = usePlayer();
  const track = state.current;

  const lyrics = useLyrics();
  const [showMenu, setShowMenu] = useState(false);
  const [showLyrics, setShowLyrics] = useState(true);
  const [isOsFullscreen, setIsOsFullscreen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Lyrics state
  const [lyricsContent, setLyricsContent] = useState<string>("");
  const [lyricsState, setLyricsState] = useState<LyricsState>("idle");
  const [wordTimeline, setWordTimeline] = useState<WordTimeline | null>(null);
  const fetchAttemptedRef = useRef<string | null>(null);
  const lastTrackIdRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  const palette = useCoverPalette(track?.coverUrl);
  const bgStyle = useMemo(() => buildPaletteBackgroundStyle(palette), [palette]);

  // Build timeline from lyrics content
  const timeline = useMemo(() => buildLrcTimeline(lyricsContent), [lyricsContent]);

  // Find active line index - no lead time to keep in sync
  const activeIndex = useMemo(() => {
    return findActiveIndex(timeline, state.position);
  }, [timeline, state.position]);

  // Calculate progress for each line
  const lineProgress = useMemo(() => {
    return getLineProgress(timeline, activeIndex, state.position);
  }, [activeIndex, timeline, state.position]);

  // Word-level active line and progress (when word timeline is available)
  const wordActiveLineIndex = useMemo(() => {
    if (!wordTimeline) return -1;
    return findActiveLineIndex(wordTimeline, state.position * 1000); // Convert to ms
  }, [wordTimeline, state.position]);

  const wordLineProgress = useMemo(() => {
    if (!wordTimeline || wordActiveLineIndex < 0) return null;
    const line = wordTimeline.lines[wordActiveLineIndex];
    if (!line) return null;
    return getWordProgress(line, state.position * 1000);
  }, [wordTimeline, wordActiveLineIndex, state.position]);

  // Auto-scroll to active line (works for both word-level and LRC)
  useEffect(() => {
    if (activeLineRef.current && scrollContainerRef.current && showLyrics) {
      const container = scrollContainerRef.current;
      const activeLine = activeLineRef.current;

      const containerRect = container.getBoundingClientRect();
      const lineRect = activeLine.getBoundingClientRect();

      const scrollTarget = activeLine.offsetTop - container.offsetTop - (containerRect.height / 2) + (lineRect.height / 2);

      container.scrollTo({
        top: scrollTarget,
        behavior: "smooth"
      });
    }
  }, [activeIndex, wordActiveLineIndex, showLyrics]);

  // Load lyrics with proper state management - AUTO-LOAD always
  useEffect(() => {
    const spotifyId = track?.spotifyId;

    if (spotifyId !== lastTrackIdRef.current) {
      lastTrackIdRef.current = spotifyId || null;
      fetchAttemptedRef.current = null;
      setLyricsContent("");
      setWordTimeline(null);
      setLyricsState("idle");
    }

    if (!spotifyId) {
      setLyricsContent("");
      setWordTimeline(null);
      setLyricsState("idle");
      return;
    }

    // Skip if we've already attempted to fetch for this track
    if (fetchAttemptedRef.current === spotifyId) {
      return;
    }

    let cancelled = false;

    (async () => {
      fetchAttemptedRef.current = spotifyId;
      setLyricsState("fetching");

      try {
        // First, try to fetch word-level lyrics for perfect sync
        // Use track's durationMs from Spotify metadata if available (more accurate)
        // Fall back to state.duration (from audio element) if not
        const durationSec = track.durationMs
          ? Math.floor(track.durationMs / 1000)
          : Math.floor(state.duration);

        const wordLyrics = await lyrics.handleFetchWordLyrics(
          track.title,
          track.artist,
          track.album || "",
          durationSec
        );

        if (cancelled) return;

        if (wordLyrics && wordLyrics.lines.length > 0) {
          setWordTimeline(wordLyrics);
          setLyricsContent(""); // Clear LRC content
          setLyricsState("loaded");
          console.log(`Word-level lyrics loaded: ${wordLyrics.lines.length} lines, source: ${wordLyrics.source}`);
          return;
        }

        // Fall back to LRC-based lyrics
        console.log("Word-level lyrics not available, trying LRC...");

        const cachedFile = await lyrics.ensureLyricsFile(spotifyId);
        if (cachedFile) {
          const text = await ReadTextFile(cachedFile);
          if (text && text.trim()) {
            setLyricsContent(text);
            setWordTimeline(null);
            setLyricsState("loaded");
            return;
          }
        }

        const downloadedFile = await lyrics.handleDownloadLyrics(
          spotifyId,
          track.title,
          track.artist
        );

        if (cancelled) return;

        if (downloadedFile) {
          const text = await ReadTextFile(downloadedFile);
          if (!cancelled) {
            if (text && text.trim()) {
              setLyricsContent(text);
              setWordTimeline(null);
              setLyricsState("loaded");
            } else {
              setLyricsState("no-lyrics");
            }
          }
        } else {
          setLyricsState("no-lyrics");
        }
      } catch (error) {
        console.error("Failed to load lyrics:", error);
        if (!cancelled) {
          setLyricsState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [track?.spotifyId, track?.title, track?.artist, track?.album, track?.durationMs]);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  // Manage OS-level fullscreen when entering/exiting the player
  useEffect(() => {
    if (state.isFullscreen) {
      // Enter OS fullscreen mode (hides taskbar)
      WindowFullscreen();
      setIsOsFullscreen(true);
    } else if (isOsFullscreen) {
      // Exit OS fullscreen mode
      WindowUnfullscreen();
      setIsOsFullscreen(false);
    }
  }, [state.isFullscreen]);

  // Handle close - exit both fullscreen modes
  const handleClose = () => {
    if (isOsFullscreen) {
      WindowUnfullscreen();
      setIsOsFullscreen(false);
    }
    player.setFullscreen(false);
  };

  if (!state.isFullscreen || !track) return null;

  const progress = state.duration > 0 ? clamp01(state.position / state.duration) : 0;

  return (
    <div className="fixed inset-0 z-50 text-white overflow-hidden" style={bgStyle}>
      {/* Subtle animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-1/4 -left-1/4 w-[80%] h-[80%] rounded-full blur-[150px] opacity-30"
          style={{
            backgroundColor: palette?.vibrant || "rgba(100, 100, 200, 0.3)",
            animation: "pulse 15s ease-in-out infinite"
          }}
        />
        <div
          className="absolute top-1/3 -right-1/4 w-[60%] h-[60%] rounded-full blur-[120px] opacity-25"
          style={{
            backgroundColor: palette?.dominant || "rgba(150, 100, 150, 0.3)",
            animation: "pulse 18s ease-in-out infinite reverse"
          }}
        />
      </div>

      {/* Backdrop blur overlay */}
      <div className="absolute inset-0 backdrop-blur-3xl bg-black/50" />

      <div className="relative h-full flex flex-col">
        {/* Header bar - Apple Music style */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/30 to-transparent z-20">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="bg-white/10 hover:bg-white/20 text-white border-0 rounded-full w-10 h-10 backdrop-blur-sm transition-all hover:scale-105"
            >
              <X className="h-5 w-5" />
            </Button>
            <div>
              <div className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Playing from</div>
              <div className="text-sm font-medium text-white/90">{track.album || "Library"}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowLyrics(!showLyrics)}
              className={cn(
                "bg-white/10 hover:bg-white/20 border-0 rounded-full w-10 h-10 backdrop-blur-sm transition-all hover:scale-105",
                showLyrics ? "text-white" : "text-white/50"
              )}
            >
              <FileText className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowMenu(!showMenu)}
              className="bg-white/10 hover:bg-white/20 text-white border-0 rounded-full w-10 h-10 backdrop-blur-sm transition-all hover:scale-105"
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>

            {/* Equalizer dropdown */}
            {showMenu && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 z-50 animate-in fade-in-0 slide-in-from-top-2 duration-200">
                <EqualizerControls useMPV={state.useMPV} />
              </div>
            )}
          </div>
        </div>

        {/* Main Content - Apple Music Style Layout */}
        <div className="flex-1 flex items-center justify-center px-8 pb-4 gap-12 overflow-hidden">
          {/* Left Side - Album Art & Track Info */}
          <div className={cn(
            "flex flex-col items-center justify-center transition-all duration-700 ease-out",
            showLyrics ? "w-[380px] flex-shrink-0" : "flex-1 max-w-lg"
          )}>
            {/* Album Art with shadow */}
            <div className="relative mb-8">
              <div
                className="absolute inset-0 rounded-lg blur-2xl opacity-40"
                style={{ backgroundColor: palette?.dominant || "rgba(0,0,0,0.3)" }}
              />
              <div className={cn(
                "relative aspect-square overflow-hidden rounded-lg shadow-2xl transition-all duration-700",
                showLyrics ? "w-[340px]" : "w-[420px]"
              )}>
                {track.coverUrl ? (
                  <img
                    src={track.coverUrl}
                    className="w-full h-full object-cover"
                    alt={track.title}
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center">
                    <Music className="w-24 h-24 text-white/20" />
                  </div>
                )}
              </div>
            </div>

            {/* Track Info - Apple Music style */}
            <div className="text-center w-full max-w-[400px]">
              <h1 className={cn(
                "font-semibold leading-tight text-white truncate mb-1",
                showLyrics ? "text-xl" : "text-2xl"
              )}>
                {track.title}
                {state.useMPV && (
                  <span className="ml-2 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded inline-block align-middle">
                    Hi-Res
                  </span>
                )}
              </h1>
              <h2 className={cn(
                "text-white/50 font-normal truncate",
                showLyrics ? "text-base" : "text-lg"
              )}>
                {track.artist} — {track.album || "Unknown Album"}
              </h2>
            </div>
          </div>

          {/* Right Side - Lyrics */}
          {showLyrics && (
            <div className="flex-1 flex flex-col min-w-0 relative h-full">
              {/* Gradient overlays for scroll fade effect - more prominent */}
              <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-black/60 via-black/30 to-transparent z-10 pointer-events-none" />
              <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/60 via-black/30 to-transparent z-10 pointer-events-none" />

              {/* Lyrics content */}
              <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto scrollbar-hide py-24"
              >
                {/* Loading state */}
                {lyricsState === "loading" && (
                  <div className="flex items-center justify-center h-full gap-3 text-white/50">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-lg">Loading lyrics...</span>
                  </div>
                )}

                {/* Fetching state */}
                {lyricsState === "fetching" && (
                  <div className="flex items-center justify-center h-full gap-3 text-white/50">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-lg">Fetching lyrics...</span>
                  </div>
                )}

                {/* Error state */}
                {lyricsState === "error" && (
                  <div className="flex flex-col items-center justify-center h-full text-white/40">
                    <Music className="h-12 w-12 mb-4" />
                    <span className="text-lg">Lyrics unavailable</span>
                  </div>
                )}

                {/* No lyrics state */}
                {lyricsState === "no-lyrics" && (
                  <div className="flex flex-col items-center justify-center h-full text-white/40">
                    <span className="text-5xl mb-4">♪</span>
                    <span className="text-lg">No lyrics available</span>
                  </div>
                )}

                {/* Idle state */}
                {lyricsState === "idle" && (
                  <div className="flex flex-col items-center justify-center h-full text-white/30">
                    <Music className="h-12 w-12 mb-4" />
                    <span className="text-lg">Waiting for track...</span>
                  </div>
                )}

                {/* Loaded lyrics - Word-level (best) with per-word karaoke highlighting */}
                {lyricsState === "loaded" && wordTimeline && wordTimeline.lines.length > 0 && (
                  <div className="space-y-8 px-6">
                    {wordTimeline.lines.map((line, index) => {
                      const isActive = index === wordActiveLineIndex;
                      const isPast = index < wordActiveLineIndex;
                      const isFuture = index > wordActiveLineIndex;
                      const activeWordIdx = isActive && wordLineProgress ? wordLineProgress.wordIndex : -1;
                      const wordProgress = isActive && wordLineProgress ? wordLineProgress.wordProgress : 0;

                      // Handle ellipsis/pause lines with animated dots
                      if (line.isEllipsis) {
                        if (isPast) return null;

                        const ellipsisProgress = isActive && line.durationMs > 0
                          ? ((state.position * 1000 - line.startMs) / line.durationMs)
                          : 0;
                        const fillPercent = Math.min(100, Math.max(0, ellipsisProgress * 100));

                        return (
                          <div
                            key={index}
                            ref={isActive ? activeLineRef : undefined}
                            className={cn(
                              "relative flex justify-center py-4",
                              "transition-all duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]",
                              isActive ? "opacity-100 scale-100" : "opacity-0 scale-90"
                            )}
                          >
                            <div
                              className="relative text-center"
                              style={{
                                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                                fontWeight: 700,
                                fontSize: "clamp(2.5rem, 5vw, 4rem)",
                                lineHeight: 1,
                                letterSpacing: "0.4em",
                              }}
                            >
                              <span style={{ color: "rgba(255, 255, 255, 0.25)" }}>
                                • • •
                              </span>
                              {fillPercent > 0 && (
                                <span
                                  className="absolute inset-0"
                                  style={{
                                    clipPath: `inset(0 ${100 - fillPercent}% 0 0)`,
                                    color: "#FFFFFF",
                                    transition: "clip-path 80ms linear",
                                    textShadow: "0 0 30px rgba(255,255,255,0.5)",
                                  }}
                                >
                                  • • •
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={index}
                          ref={isActive ? activeLineRef : undefined}
                          className={cn(
                            "relative cursor-pointer",
                            "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                            "hover:opacity-90 active:scale-[0.99]",
                            isActive && "scale-[1.02]",
                            isFuture && "opacity-60"
                          )}
                          onClick={() => {
                            player.seek(line.startMs / 1000);
                          }}
                        >
                          <div
                            className={cn(
                              "relative inline-block w-full transition-all duration-400",
                              isActive && "drop-shadow-[0_0_40px_rgba(255,255,255,0.15)]"
                            )}
                            style={{
                              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                              fontWeight: isActive ? 700 : isPast ? 600 : 500,
                              fontSize: isActive ? "clamp(1.6rem, 2.8vw, 2.4rem)" : "clamp(1.3rem, 2.2vw, 1.9rem)",
                              lineHeight: 1.4,
                              letterSpacing: "-0.015em",
                              whiteSpace: "normal",
                              wordBreak: "break-word",
                            }}
                          >
                            {line.words.map((word, wordIdx) => {
                              const isWordPast = isPast || (isActive && wordIdx < activeWordIdx);
                              const isWordActive = isActive && wordIdx === activeWordIdx;
                              const isWordFuture = !isPast && !isWordPast && !isWordActive;
                              const fillPercent = isWordActive ? wordProgress * 100 : (isWordPast ? 100 : 0);

                              return (
                                <span
                                  key={wordIdx}
                                  className={cn(
                                    "relative inline-block transition-all duration-200",
                                    isWordActive && "scale-[1.02]"
                                  )}
                                  style={{
                                    marginRight: wordIdx < line.words.length - 1 ? "0.22em" : 0,
                                  }}
                                >
                                  <span
                                    className="transition-colors duration-300"
                                    style={{
                                      color: isWordFuture
                                        ? "rgba(255, 255, 255, 0.35)"
                                        : isWordActive
                                          ? "rgba(255, 255, 255, 0.45)"
                                          : isPast
                                            ? "rgba(255, 255, 255, 0.55)"
                                            : "rgba(255, 255, 255, 0.4)",
                                    }}
                                  >
                                    {word.text}
                                  </span>

                                  {(isWordPast || isWordActive) && fillPercent > 0 && (
                                    <span
                                      className="absolute inset-0"
                                      style={{
                                        clipPath: `inset(0 ${100 - fillPercent}% 0 0)`,
                                        color: "#FFFFFF",
                                        transition: "clip-path 60ms linear",
                                        textShadow: isWordActive ? "0 0 20px rgba(255,255,255,0.4)" : "none",
                                      }}
                                    >
                                      {word.text}
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Loaded lyrics - LRC fallback */}
                {lyricsState === "loaded" && !wordTimeline && timeline.length > 0 && (
                  <div className="space-y-8 px-6">
                    {timeline.map((line, index) => {
                      const isActive = index === activeIndex;
                      const isPast = index < activeIndex;
                      const isFuture = index > activeIndex;
                      const isEllipsis = line.kind === "ellipsis";
                      const progress = lineProgress[index] || 0;

                      if (isEllipsis) {
                        if (isPast) return null;

                        const nextLine = timeline[index + 1];
                        const ellipsisDuration = nextLine ? nextLine.t - line.t : 3;
                        const ellipsisProgress = isActive && ellipsisDuration > 0
                          ? (state.position - line.t) / ellipsisDuration
                          : 0;
                        const fillPercent = Math.min(100, Math.max(0, ellipsisProgress * 100));

                        return (
                          <div
                            key={index}
                            ref={isActive ? activeLineRef : undefined}
                            className={cn(
                              "relative flex justify-center py-4",
                              "transition-all duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]",
                              isActive ? "opacity-100 scale-100" : "opacity-0 scale-90"
                            )}
                          >
                            <div
                              className="relative text-center"
                              style={{
                                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                                fontWeight: 700,
                                fontSize: "clamp(2.5rem, 5vw, 4rem)",
                                lineHeight: 1,
                                letterSpacing: "0.4em",
                              }}
                            >
                              <span style={{ color: "rgba(255, 255, 255, 0.25)" }}>
                                • • •
                              </span>
                              {fillPercent > 0 && (
                                <span
                                  className="absolute inset-0"
                                  style={{
                                    clipPath: `inset(0 ${100 - fillPercent}% 0 0)`,
                                    color: "#FFFFFF",
                                    transition: "clip-path 80ms linear",
                                    textShadow: "0 0 30px rgba(255,255,255,0.5)",
                                  }}
                                >
                                  • • •
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={index}
                          ref={isActive ? activeLineRef : undefined}
                          className={cn(
                            "relative cursor-pointer",
                            "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                            "hover:opacity-90 active:scale-[0.99]",
                            isActive && "scale-[1.02]",
                            isFuture && "opacity-60"
                          )}
                          onClick={() => {
                            if (line.t !== undefined) {
                              player.seek(line.t);
                            }
                          }}
                        >
                          <div
                            className={cn(
                              "relative inline-block w-full transition-all duration-400",
                              isActive && "drop-shadow-[0_0_40px_rgba(255,255,255,0.15)]"
                            )}
                            style={{
                              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                              fontWeight: isActive ? 700 : isPast ? 600 : 500,
                              fontSize: isActive ? "clamp(1.6rem, 2.8vw, 2.4rem)" : "clamp(1.3rem, 2.2vw, 1.9rem)",
                              lineHeight: 1.4,
                              letterSpacing: "-0.015em",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            <span
                              className="transition-colors duration-300"
                              style={{
                                color: isPast
                                  ? "rgba(255, 255, 255, 0.55)"
                                  : isActive
                                    ? "rgba(255, 255, 255, 0.45)"
                                    : "rgba(255, 255, 255, 0.35)",
                              }}
                            >
                              {line.text}
                            </span>

                            {isActive && progress > 0 && (
                              <span
                                className="absolute inset-0 overflow-hidden"
                                style={{
                                  clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
                                  transition: "clip-path 60ms linear",
                                }}
                              >
                                <span style={{
                                  color: "#FFFFFF",
                                  textShadow: "0 0 20px rgba(255,255,255,0.4)",
                                }}>
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
          )}
        </div>

        {/* Bottom Control Bar - Apple Music Style */}
        <div className="px-8 pb-8">
          {/* Progress Bar */}
          <div className="max-w-3xl mx-auto mb-4">
            <div
              className="group h-1 w-full bg-white/20 rounded-full overflow-hidden cursor-pointer hover:h-1.5 transition-all duration-200"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percent = x / rect.width;
                player.seek(percent * state.duration);
              }}
            >
              <div
                className="h-full bg-white/80 rounded-full relative transition-all duration-100"
                style={{ width: `${progress * 100}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg" />
              </div>
            </div>
            <div className="flex justify-between mt-2 text-xs text-white/50 font-mono tabular-nums">
              <span>{formatTime(state.position)}</span>
              <span>-{formatTime(state.duration - state.position)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-6">
            {/* Volume */}
            <div className="flex items-center gap-2 w-32">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => player.setVolume(state.volume > 0 ? 0 : 1)}
                className="h-8 w-8 hover:bg-white/10 text-white/60 hover:text-white rounded-full flex-shrink-0"
              >
                {state.volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={state.volume}
                onChange={(e) => player.setVolume(Number(e.target.value))}
                className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
              />
            </div>

            {/* Menu button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowMenu(!showMenu)}
              className="h-9 w-9 hover:bg-white/10 text-white/60 hover:text-white rounded-full"
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>

            {/* Playback controls */}
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 hover:bg-white/10 text-white/80 hover:text-white rounded-full"
              onClick={() => player.previous()}
            >
              <SkipBack className="h-5 w-5 fill-current" />
            </Button>

            <Button
              onClick={() => player.togglePlay()}
              size="icon"
              className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 text-white hover:scale-105 transition-all duration-200"
            >
              {state.isPlaying ? (
                <Pause className="h-6 w-6 fill-current" />
              ) : (
                <Play className="h-6 w-6 fill-current ml-0.5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 hover:bg-white/10 text-white/80 hover:text-white rounded-full"
              onClick={() => player.next()}
            >
              <SkipForward className="h-5 w-5 fill-current" />
            </Button>

            {/* Lyrics toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowLyrics(!showLyrics)}
              className={cn(
                "h-9 w-9 hover:bg-white/10 border-0 rounded-full transition-colors",
                showLyrics ? "text-white bg-white/20" : "text-white/60"
              )}
            >
              <FileText className="h-5 w-5" />
            </Button>

            {/* Empty spacer to balance volume */}
            <div className="w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
