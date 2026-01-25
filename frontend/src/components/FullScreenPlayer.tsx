import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { FileText, X, Heart, MoreHorizontal, Repeat, Shuffle, SkipBack, SkipForward, Play, Pause, Volume2, VolumeX, Loader2, Music } from "lucide-react";
import { usePlayer } from "../hooks/usePlayer";
import { Button } from "./ui/button";
import { useLyrics } from "../hooks/useLyrics";
import { cn } from "@/lib/utils";
import { buildPaletteBackgroundStyle } from "@/lib/cover/palette";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { EqualizerControls } from "./EqualizerControls";
import { ReadTextFile } from "../../wailsjs/go/main/App";
import { buildLrcTimeline, findActiveIndex, getLineProgress } from "@/lib/lyrics/lrc";
import { getSettings } from "@/lib/settings";
import type { WordTimeline } from "@/lib/lyrics/wordLyrics";
import { findActiveLineIndex, getWordProgress } from "@/lib/lyrics/wordLyrics";

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

type LyricsState = "idle" | "loading" | "fetching" | "loaded" | "error" | "no-lyrics" | "on-demand";

export function FullScreenPlayer() {
  const { state, player } = usePlayer();
  const track = state.current;

  const lyrics = useLyrics();
  const [isFavorite, setIsFavorite] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLyrics, setShowLyrics] = useState(true);
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

  // Load lyrics with proper state management
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

    const settings = getSettings();
    const lyricsMode = settings.lyricsMode || "on-demand";

    if (lyricsMode === "on-demand") {
      setLyricsState("on-demand");
      return;
    }

    let cancelled = false;

    (async () => {
      setLyricsState("loading");

      try {
        const filePath = await lyrics.ensureLyricsFile(spotifyId);

        if (cancelled) return;

        if (filePath) {
          const text = await ReadTextFile(filePath);
          if (!cancelled) {
            if (text && text.trim()) {
              setLyricsContent(text);
              setLyricsState("loaded");
            } else {
              setLyricsState("no-lyrics");
            }
          }
          return;
        }

        if (fetchAttemptedRef.current === spotifyId) {
          setLyricsState("no-lyrics");
          return;
        }

        fetchAttemptedRef.current = spotifyId;
        setLyricsState("fetching");

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
  }, [track?.spotifyId, track?.title, track?.artist]);

  // Manual fetch for on-demand mode - tries word-level first, falls back to LRC
  const handleManualFetch = useCallback(async () => {
    if (!track?.spotifyId) return;

    setLyricsState("fetching");
    fetchAttemptedRef.current = track.spotifyId;

    try {
      // First, try to fetch word-level lyrics for perfect sync
      const wordLyrics = await lyrics.handleFetchWordLyrics(
        track.title,
        track.artist,
        track.album || "",
        Math.floor(state.duration)
      );

      if (wordLyrics && wordLyrics.lines.length > 0) {
        setWordTimeline(wordLyrics);
        setLyricsContent(""); // Clear LRC content
        setLyricsState("loaded");
        console.log(`Word-level lyrics loaded: ${wordLyrics.lines.length} lines, source: ${wordLyrics.source}`);
        return;
      }

      // Fall back to LRC-based lyrics
      console.log("Word-level lyrics not available, trying LRC...");

      const cachedFile = await lyrics.ensureLyricsFile(track.spotifyId);
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
        track.spotifyId,
        track.title,
        track.artist
      );

      if (downloadedFile) {
        const text = await ReadTextFile(downloadedFile);
        if (text && text.trim()) {
          setLyricsContent(text);
          setWordTimeline(null);
          setLyricsState("loaded");
        } else {
          setLyricsState("no-lyrics");
        }
      } else {
        setLyricsState("no-lyrics");
      }
    } catch (error) {
      console.error("Failed to fetch lyrics:", error);
      setLyricsState("error");
    }
  }, [track?.spotifyId, track?.title, track?.artist, track?.album, state.duration, lyrics]);

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

  if (!state.isFullscreen || !track) return null;

  const progress = state.duration > 0 ? clamp01(state.position / state.duration) : 0;

  return (
    <div className="fixed inset-0 z-50 text-white overflow-hidden" style={bgStyle}>
      {/* Animated background elements - larger and more subtle */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full blur-[120px] opacity-25 animate-[pulse_10s_ease-in-out_infinite]"
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
      <div className="absolute inset-0 backdrop-blur-3xl bg-black/40" />

      <div className="relative h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/20 to-transparent">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => player.setFullscreen(false)}
              className="bg-white/10 hover:bg-white/20 text-white border-0 rounded-full w-10 h-10 backdrop-blur-sm"
            >
              <X className="h-5 w-5" />
            </Button>
            <div>
              <div className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Playing from</div>
              <div className="text-sm font-medium text-white/90">{track.album || "Library"}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 relative" ref={menuRef}>
            {/* Toggle lyrics button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowLyrics(!showLyrics)}
              className={cn(
                "bg-white/10 hover:bg-white/20 border-0 rounded-full w-10 h-10 backdrop-blur-sm transition-colors",
                showLyrics ? "text-white" : "text-white/50"
              )}
            >
              <FileText className="h-5 w-5" />
            </Button>
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
        <div className="flex-1 flex items-stretch px-8 py-4 gap-8 overflow-hidden">
          {/* Left Side - Album Art & Controls */}
          <div className={cn(
            "flex flex-col justify-center transition-all duration-500",
            showLyrics ? "w-[420px] flex-shrink-0" : "flex-1 max-w-2xl mx-auto"
          )}>
            {/* Album Art */}
            <div className="relative group mb-6">
              <div className="absolute -inset-3 bg-white/5 rounded-2xl blur-xl opacity-50" />
              <div className={cn(
                "relative aspect-square overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 transition-all duration-500",
                showLyrics ? "w-full" : "w-full max-w-md mx-auto"
              )}>
                {track.coverUrl ? (
                  <img
                    src={track.coverUrl}
                    className="w-full h-full object-cover"
                    alt={track.title}
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center">
                    <div className="text-6xl text-white/20">♫</div>
                  </div>
                )}
              </div>
            </div>

            {/* Track Info */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-1">
                <h1 className={cn(
                  "font-bold leading-tight text-white truncate",
                  showLyrics ? "text-2xl" : "text-4xl"
                )}>
                  {track.title}
                </h1>
                {state.useMPV && (
                  <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded flex-shrink-0">
                    Hi-Res
                  </span>
                )}
              </div>
              <h2 className={cn(
                "text-white/60 font-medium truncate",
                showLyrics ? "text-lg" : "text-xl"
              )}>
                {track.artist}
              </h2>
            </div>

            {/* Progress Bar */}
            <div className="mb-6">
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
                  className="h-full bg-white/90 rounded-full relative transition-all duration-100"
                  style={{ width: `${progress * 100}%` }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg" />
                </div>
              </div>
              <div className="flex justify-between mt-2 text-[13px] text-white/50 font-mono tabular-nums">
                <span>{formatTime(state.position)}</span>
                <span>-{formatTime(state.duration - state.position)}</span>
              </div>
            </div>

            {/* Playback Controls */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => player.toggleShuffle()}
                  className={cn(
                    "h-10 w-10 hover:bg-white/10 transition-colors rounded-full",
                    state.shuffle ? "text-green-400" : "text-white/50 hover:text-white"
                  )}
                >
                  <Shuffle className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 hover:bg-white/10 text-white/80 hover:text-white rounded-full"
                  onClick={() => player.previous()}
                >
                  <SkipBack className="h-5 w-5" />
                </Button>
              </div>

              <Button
                onClick={() => player.togglePlay()}
                size="icon"
                className="w-14 h-14 rounded-full bg-white hover:bg-white/90 text-black hover:scale-105 transition-all duration-200 shadow-xl"
              >
                {state.isPlaying ? (
                  <Pause className="h-6 w-6 fill-current" />
                ) : (
                  <Play className="h-6 w-6 fill-current ml-0.5" />
                )}
              </Button>

              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 hover:bg-white/10 text-white/80 hover:text-white rounded-full"
                  onClick={() => player.next()}
                >
                  <SkipForward className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => player.cycleRepeat()}
                  className={cn(
                    "h-10 w-10 hover:bg-white/10 transition-colors rounded-full",
                    state.repeat !== "off" ? "text-green-400" : "text-white/50 hover:text-white"
                  )}
                >
                  <Repeat className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Volume & Actions */}
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => player.setVolume(state.volume > 0 ? 0 : 1)}
                className="h-9 w-9 hover:bg-white/10 text-white/60 hover:text-white rounded-full flex-shrink-0"
              >
                {state.volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
              <div className="flex-1">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={state.volume}
                  onChange={(e) => player.setVolume(Number(e.target.value))}
                  className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg hover:[&::-webkit-slider-thumb]:scale-110 [&::-webkit-slider-thumb]:transition-transform"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsFavorite(!isFavorite)}
                className={cn(
                  "h-9 w-9 hover:bg-white/10 transition-colors rounded-full",
                  isFavorite ? "text-red-500 hover:text-red-400" : "text-white/60 hover:text-white"
                )}
              >
                <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} />
              </Button>
            </div>

            {/* Quality Info */}
            {track.isrc && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center gap-4 text-[12px] text-white/40">
                  <span>ISRC: {track.isrc}</span>
                  <span>Quality: {state.useMPV ? "Hi-Res FLAC" : "High"}</span>
                </div>
              </div>
            )}
          </div>

          {/* Right Side - Lyrics */}
          {showLyrics && (
            <div className="flex-1 flex flex-col min-w-0 relative">
              {/* Gradient overlays for scroll fade effect */}
              <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-black/30 to-transparent z-10 pointer-events-none" />
              <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/30 to-transparent z-10 pointer-events-none" />

              {/* Lyrics content */}
              <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto scrollbar-hide py-20"
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

                {/* On-demand mode */}
                {lyricsState === "on-demand" && (
                  <div className="flex flex-col items-center justify-center h-full">
                    <Button
                      variant="ghost"
                      size="lg"
                      onClick={handleManualFetch}
                      className="text-white/60 hover:text-white hover:bg-white/10 gap-3 h-14 px-8 rounded-full"
                    >
                      <FileText className="h-6 w-6" />
                      <span className="text-lg">Load Lyrics</span>
                    </Button>
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
                  <div className="space-y-4 px-4">
                    {wordTimeline.lines.map((line, index) => {
                      const isActive = index === wordActiveLineIndex;
                      const isPast = index < wordActiveLineIndex;
                      const activeWordIdx = isActive && wordLineProgress ? wordLineProgress.wordIndex : -1;
                      const wordProgress = isActive && wordLineProgress ? wordLineProgress.wordProgress : 0;

                      // Handle ellipsis/pause lines with animated dots
                      if (line.isEllipsis) {
                        // Don't show past ellipsis lines
                        if (isPast) return null;

                        // Calculate fill progress for the dots (same as lyrics fill)
                        const ellipsisProgress = isActive && line.durationMs > 0
                          ? ((state.position * 1000 - line.startMs) / line.durationMs)
                          : 0;
                        const fillPercent = Math.min(100, Math.max(0, ellipsisProgress * 100));

                        return (
                          <div
                            key={index}
                            ref={isActive ? activeLineRef : undefined}
                            className={cn(
                              "relative transition-all duration-500 ease-out flex justify-center",
                              isActive ? "opacity-100" : "opacity-0"
                            )}
                          >
                            <div
                              className="relative text-center"
                              style={{
                                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                                fontWeight: 600,
                                fontSize: "clamp(2rem, 4vw, 3rem)",
                                lineHeight: 1,
                                letterSpacing: "0.3em",
                                WebkitFontSmoothing: "antialiased",
                                MozOsxFontSmoothing: "grayscale",
                              }}
                            >
                              {/* Background dots (unfilled) */}
                              <span style={{ color: "rgba(255, 255, 255, 0.3)" }}>
                                ...
                              </span>
                              {/* Filled dots overlay with clip animation */}
                              {fillPercent > 0 && (
                                <span
                                  className="absolute inset-0"
                                  style={{
                                    clipPath: `inset(0 ${100 - fillPercent}% 0 0)`,
                                    color: "#FFFFFF",
                                  }}
                                >
                                  ...
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
                            "relative transition-all duration-500 ease-out cursor-pointer hover:opacity-80",
                            isActive && "scale-[1.01]"
                          )}
                          onClick={() => {
                            player.seek(line.startMs / 1000);
                          }}
                        >
                          <div
                            className="relative inline-block w-full"
                            style={{
                              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                              fontWeight: isActive ? 700 : 600,
                              fontSize: isActive ? "clamp(1.5rem, 2.5vw, 2.25rem)" : "clamp(1.25rem, 2vw, 1.75rem)",
                              lineHeight: 1.4,
                              letterSpacing: "-0.02em",
                              whiteSpace: "normal",
                              wordBreak: "break-word",
                              WebkitFontSmoothing: "antialiased",
                              MozOsxFontSmoothing: "grayscale",
                            }}
                          >
                            {/* Render each word separately for per-word karaoke highlighting */}
                            {line.words.map((word, wordIdx) => {
                              const isWordPast = isPast || (isActive && wordIdx < activeWordIdx);
                              const isWordActive = isActive && wordIdx === activeWordIdx;
                              const isWordFuture = !isPast && !isWordPast && !isWordActive;

                              // For the active word, calculate the fill percentage
                              const fillPercent = isWordActive ? wordProgress * 100 : (isWordPast ? 100 : 0);

                              return (
                                <span
                                  key={wordIdx}
                                  className="relative inline-block"
                                  style={{
                                    marginRight: wordIdx < line.words.length - 1 ? "0.25em" : 0,
                                  }}
                                >
                                  {/* Background (unhighlighted) text */}
                                  <span
                                    style={{
                                      color: isWordFuture
                                        ? "rgba(255, 255, 255, 0.3)"
                                        : isWordActive
                                          ? "rgba(255, 255, 255, 0.4)"
                                          : "rgba(255, 255, 255, 0.5)",
                                    }}
                                  >
                                    {word.text}
                                  </span>

                                  {/* Highlighted overlay with clip for active word fill effect */}
                                  {(isWordPast || isWordActive) && fillPercent > 0 && (
                                    <span
                                      className="absolute inset-0"
                                      style={{
                                        clipPath: `inset(0 ${100 - fillPercent}% 0 0)`,
                                        color: "#FFFFFF",
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

                {/* Loaded lyrics - LRC fallback (Apple Music style) */}
                {lyricsState === "loaded" && !wordTimeline && timeline.length > 0 && (
                  <div className="space-y-4 px-4">
                    {timeline.map((line, index) => {
                      const isActive = index === activeIndex;
                      const isPast = index < activeIndex;
                      const isEllipsis = line.kind === "ellipsis";
                      const progress = lineProgress[index] || 0;

                      // Handle ellipsis/pause lines with animated dots
                      if (isEllipsis) {
                        // Don't show past ellipsis lines
                        if (isPast) return null;

                        // Calculate fill progress for the dots (same as lyrics fill)
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
                              "relative transition-all duration-500 ease-out flex justify-center",
                              isActive ? "opacity-100" : "opacity-0"
                            )}
                          >
                            <div
                              className="relative text-center"
                              style={{
                                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                                fontWeight: 600,
                                fontSize: "clamp(2rem, 4vw, 3rem)",
                                lineHeight: 1,
                                letterSpacing: "0.3em",
                                WebkitFontSmoothing: "antialiased",
                                MozOsxFontSmoothing: "grayscale",
                              }}
                            >
                              {/* Background dots (unfilled) */}
                              <span style={{ color: "rgba(255, 255, 255, 0.3)" }}>
                                ...
                              </span>
                              {/* Filled dots overlay with clip animation */}
                              {fillPercent > 0 && (
                                <span
                                  className="absolute inset-0"
                                  style={{
                                    clipPath: `inset(0 ${100 - fillPercent}% 0 0)`,
                                    color: "#FFFFFF",
                                  }}
                                >
                                  ...
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
                            "relative transition-all duration-500 ease-out cursor-pointer hover:opacity-80",
                            isActive && "scale-[1.01]"
                          )}
                          onClick={() => {
                            if (line.t !== undefined) {
                              player.seek(line.t);
                            }
                          }}
                        >
                          <div
                            className="relative inline-block w-full"
                            style={{
                              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                              fontWeight: isActive ? 700 : 600,
                              fontSize: isActive ? "clamp(1.5rem, 2.5vw, 2.25rem)" : "clamp(1.25rem, 2vw, 1.75rem)",
                              lineHeight: 1.4,
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
                                  ? "rgba(255, 255, 255, 0.5)"
                                  : isActive
                                    ? "rgba(255, 255, 255, 0.4)"
                                    : "rgba(255, 255, 255, 0.3)",
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
          )}
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
