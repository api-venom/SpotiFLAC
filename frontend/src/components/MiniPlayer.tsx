import { Play, Pause, SkipBack, SkipForward, Maximize2, Music, Loader2, ListMusic, FileText } from "lucide-react";
import { Button } from "./ui/button";
import { usePlayer } from "@/hooks/usePlayer";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { ReadTextFile } from "../../wailsjs/go/main/App";
import { useLyrics } from "@/hooks/useLyrics";
import { buildLrcTimeline, findActiveIndex, getLineProgress } from "@/lib/lyrics/lrc";
import { getSettings } from "@/lib/settings";
import type { WordTimeline } from "@/lib/lyrics/wordLyrics";
import { findActiveLineIndex, getWordProgress } from "@/lib/lyrics/wordLyrics";

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

async function extractDominantColor(url?: string): Promise<string | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;

        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] || 0;
          if (a < 16) continue;
          r += data[i] || 0;
          g += data[i + 1] || 0;
          b += data[i + 2] || 0;
          n++;
        }

        if (n === 0) return resolve(null);
        resolve(`rgb(${Math.round(r/n)}, ${Math.round(g/n)}, ${Math.round(b/n)})`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

type LyricsState = "idle" | "loading" | "fetching" | "loaded" | "error" | "no-lyrics" | "on-demand";

interface MiniPlayerProps {
  onQueueOpen?: () => void;
}

export function MiniPlayer({ onQueueOpen }: MiniPlayerProps = {}) {
  const { state, player } = usePlayer();
  const track = state.current;
  const [bgColor, setBgColor] = useState<string | null>(null);
  const lyrics = useLyrics();
  const [lyricsContent, setLyricsContent] = useState<string>("");
  const [lyricsState, setLyricsState] = useState<LyricsState>("idle");
  const [wordTimeline, setWordTimeline] = useState<WordTimeline | null>(null);

  // Track which spotify ID we've already attempted to fetch for
  const fetchAttemptedRef = useRef<string | null>(null);
  const lastTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (track?.coverUrl) {
      extractDominantColor(track.coverUrl).then(setBgColor);
    } else {
      setBgColor(null);
    }
  }, [track?.coverUrl]);

  // Load lyrics with proper state management - no infinite loops
  useEffect(() => {
    const spotifyId = track?.spotifyId;

    // Reset state when track changes
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

    // In on-demand mode, don't auto-load lyrics
    if (lyricsMode === "on-demand") {
      setLyricsState("on-demand");
      return;
    }

    // Auto mode: try to load lyrics
    let cancelled = false;

    (async () => {
      setLyricsState("loading");

      try {
        // First check if we have cached lyrics
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

        // No cached lyrics - try to fetch if we haven't already
        if (fetchAttemptedRef.current === spotifyId) {
          // Already attempted fetch for this track
          setLyricsState("no-lyrics");
          return;
        }

        // Mark that we're attempting to fetch
        fetchAttemptedRef.current = spotifyId;
        setLyricsState("fetching");

        // Try to download lyrics
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

      // First check cache
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

      // Download lyrics
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

  const timeline = useMemo(() => buildLrcTimeline(lyricsContent), [lyricsContent]);

  // Find active line index for LRC
  const activeIndex = useMemo(() => {
    return findActiveIndex(timeline, state.position);
  }, [timeline, state.position]);

  // Use the improved getLineProgress for proper sync
  const lineProgress = useMemo(() => {
    return getLineProgress(timeline, activeIndex, state.position);
  }, [timeline, activeIndex, state.position]);

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

  // Get current and next lines with proper progress (for both word and LRC)
  const { currentLine, nextLine, currentProgress, isWordLevel, currentWordProgress } = useMemo(() => {
    // Prefer word timeline if available
    if (wordTimeline && wordActiveLineIndex >= 0) {
      const current = wordTimeline.lines[wordActiveLineIndex];
      const next = wordActiveLineIndex + 1 < wordTimeline.lines.length
        ? wordTimeline.lines[wordActiveLineIndex + 1]
        : null;
      return {
        currentLine: current,
        nextLine: next,
        currentProgress: wordLineProgress?.lineProgress || 0,
        isWordLevel: true,
        currentWordProgress: wordLineProgress,
      };
    }

    // Fall back to LRC timeline
    if (!timeline.length || activeIndex < 0) {
      return { currentLine: null as any, nextLine: null as any, currentProgress: 0, isWordLevel: false, currentWordProgress: null };
    }

    const current = timeline[activeIndex];
    const next = activeIndex + 1 < timeline.length ? timeline[activeIndex + 1] : null;

    return {
      currentLine: current,
      nextLine: next,
      currentProgress: lineProgress[activeIndex] || 0,
      isWordLevel: false,
      currentWordProgress: null,
    };
  }, [wordTimeline, wordActiveLineIndex, wordLineProgress, timeline, activeIndex, lineProgress]);

  if (!track || state.isFullscreen) return null;

  const progress = state.duration > 0 ? clamp01(state.position / state.duration) : 0;

  // Solid background with extracted color
  const bgStyle = bgColor
    ? {
        backgroundColor: bgColor,
        opacity: 0.95,
      }
    : {
        backgroundColor: "rgba(25, 25, 35, 0.95)",
      };

  return (
    <div
      className="fixed bottom-0 left-14 right-0 z-[35] border-t border-white/10 shadow-2xl backdrop-blur-md transition-all duration-300"
      style={bgStyle}
    >
      {/* Progress bar - Apple Music style thin line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/10">
        <div
          className="h-full bg-white/90 transition-all duration-100 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="px-5 py-3 flex items-center gap-6">
        {/* Album Art & Info */}
        <div className="flex items-center gap-4 flex-1 min-w-0 max-w-md">
          {track.coverUrl && (
            <img
              src={track.coverUrl}
              alt={track.title}
              className="w-12 h-12 rounded-lg shadow-lg object-cover flex-shrink-0 ring-1 ring-white/10"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white truncate text-[15px] leading-tight">
                {track.title}
              </span>
              {state.useMPV && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded flex-shrink-0">
                  Hi-Res
                </span>
              )}
            </div>
            <div className="text-white/60 truncate text-[13px] leading-tight mt-0.5">
              {track.artist}
            </div>
          </div>
        </div>

        {/* Lyrics Display - Apple Music Style */}
        <div className="flex-1 min-w-0 max-w-2xl">
          {/* Loading state */}
          {lyricsState === "loading" && (
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading lyrics...</span>
            </div>
          )}

          {/* Fetching state */}
          {lyricsState === "fetching" && (
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Fetching lyrics...</span>
            </div>
          )}

          {/* Error state */}
          {lyricsState === "error" && (
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <Music className="h-4 w-4" />
              <span>Lyrics unavailable</span>
            </div>
          )}

          {/* No lyrics state */}
          {lyricsState === "no-lyrics" && (
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <Music className="h-4 w-4" />
              <span>No lyrics available</span>
            </div>
          )}

          {/* On-demand mode - show button to fetch */}
          {lyricsState === "on-demand" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualFetch}
              className="text-white/50 hover:text-white/80 hover:bg-white/10 gap-2 h-8"
            >
              <FileText className="h-4 w-4" />
              <span className="text-sm">Show Lyrics</span>
            </Button>
          )}

          {/* Loaded lyrics - Apple Music style display */}
          {lyricsState === "loaded" && (wordTimeline || timeline.length > 0) && (
            <div className="space-y-0.5">
              {/* Current line - prominent */}
              {currentLine && (isWordLevel ? !currentLine.isEllipsis : currentLine.kind === "lyric") ? (
                <div className="relative overflow-hidden">
                  {isWordLevel && currentWordProgress ? (
                    // Word-level rendering with per-word highlighting
                    <div className="flex flex-wrap items-center gap-x-1">
                      {currentLine.words.map((word: any, wordIdx: number) => {
                        const isWordPast = wordIdx < currentWordProgress.wordIndex;
                        const isWordActive = wordIdx === currentWordProgress.wordIndex;
                        const fillPercent = isWordActive
                          ? currentWordProgress.wordProgress * 100
                          : (isWordPast ? 100 : 0);

                        return (
                          <span key={wordIdx} className="relative inline-block">
                            {/* Background text */}
                            <span
                              className="text-[15px] font-medium"
                              style={{ color: "rgba(255, 255, 255, 0.35)" }}
                            >
                              {word.text}
                            </span>
                            {/* Highlighted overlay */}
                            {(isWordPast || isWordActive) && fillPercent > 0 && (
                              <span
                                className="absolute inset-0"
                                style={{
                                  clipPath: `inset(0 ${100 - fillPercent}% 0 0)`,
                                  color: "rgba(255, 255, 255, 0.95)",
                                }}
                              >
                                {word.text}
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    // LRC line-level rendering
                    <>
                      {/* Background/unfilled text */}
                      <div
                        className="text-[15px] font-medium truncate"
                        style={{ color: "rgba(255, 255, 255, 0.35)" }}
                      >
                        {currentLine.text}
                      </div>
                      {/* Filled text with karaoke effect */}
                      <div
                        className="absolute inset-0 overflow-hidden"
                        style={{
                          clipPath: `inset(0 ${(1 - currentProgress) * 100}% 0 0)`,
                        }}
                      >
                        <div
                          className="text-[15px] font-medium truncate"
                          style={{ color: "rgba(255, 255, 255, 0.95)" }}
                        >
                          {currentLine.text}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : currentLine && (isWordLevel ? currentLine.isEllipsis : currentLine.kind === "ellipsis") ? (
                // Ellipsis/pause display with fill animation
                <div className="relative h-5 flex items-center">
                  <span className="text-white/30 text-[15px] font-medium">...</span>
                  {currentProgress > 0 && (
                    <span
                      className="absolute inset-0 flex items-center"
                      style={{
                        clipPath: `inset(0 ${(1 - currentProgress) * 100}% 0 0)`,
                      }}
                    >
                      <span className="text-white/90 text-[15px] font-medium">...</span>
                    </span>
                  )}
                </div>
              ) : (
                <div className="h-5 flex items-center">
                  {state.isPlaying && (
                    <span className="text-white/30 text-sm animate-pulse">...</span>
                  )}
                </div>
              )}

              {/* Next line - subtle preview */}
              {nextLine && (isWordLevel ? !nextLine.isEllipsis : nextLine.kind === "lyric") ? (
                <div
                  className="text-[13px] font-medium truncate"
                  style={{ color: "rgba(255, 255, 255, 0.25)" }}
                >
                  {nextLine.text}
                </div>
              ) : (
                <div className="h-4" />
              )}
            </div>
          )}

          {/* Idle state */}
          {lyricsState === "idle" && (
            <div className="text-white/30 text-sm">
              <Music className="h-4 w-4 inline-block mr-2" />
              <span>Waiting for track...</span>
            </div>
          )}
        </div>

        {/* Playback Controls - Apple Music style */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => player.previous()}
          >
            <SkipBack className="h-4 w-4" />
          </Button>

          <Button
            onClick={() => player.togglePlay()}
            size="icon"
            className="h-10 w-10 rounded-full bg-white hover:bg-white/90 text-black hover:scale-105 transition-all shadow-lg"
          >
            {state.isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current ml-0.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => player.next()}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Time & Controls */}
        <div className="flex items-center gap-3">
          <div className="text-[13px] text-white/60 font-mono min-w-[5rem] text-right tabular-nums">
            {formatTime(state.position)} / {formatTime(state.duration)}
          </div>
          {onQueueOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onQueueOpen}
              className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <ListMusic className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => player.setFullscreen(true)}
            className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
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
