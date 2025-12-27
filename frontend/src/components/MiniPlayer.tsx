import { Play, Pause, SkipBack, SkipForward, Maximize2 } from "lucide-react";
import { Button } from "./ui/button";
import { usePlayer } from "@/hooks/usePlayer";
import { useEffect, useState, useMemo } from "react";
import { ReadTextFile } from "../../wailsjs/go/main/App";
import { useLyrics } from "@/hooks/useLyrics";
import { buildLrcTimeline, findActiveIndex } from "@/lib/lyrics/lrc";

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


export function MiniPlayer() {
  const { state, player } = usePlayer();
  const track = state.current;
  const [bgColor, setBgColor] = useState<string | null>(null);
  const lyrics = useLyrics();
  const [lyricsContent, setLyricsContent] = useState<string>("");
  const [dotCount, setDotCount] = useState(0);

  useEffect(() => {
    if (track?.coverUrl) {
      extractDominantColor(track.coverUrl).then(setBgColor);
    } else {
      setBgColor(null);
    }
  }, [track?.coverUrl]);

  // Load lyrics
  useEffect(() => {
    if (!track?.spotifyId) {
      setLyricsContent("");
      return;
    }

    (async () => {
      try {
        const filePath = await lyrics.ensureLyricsFile(track.spotifyId);
        if (filePath) {
          const text = await ReadTextFile(filePath);
          setLyricsContent(text || "");
        } else {
          setLyricsContent("");
        }
      } catch {
        setLyricsContent("");
      }
    })();
  }, [track?.spotifyId, lyrics]);

  // Animated dots for instrumental breaks
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const timeline = useMemo(() => buildLrcTimeline(lyricsContent), [lyricsContent]);

  // Find current and next lyrics
  const { currentLine, nextLine, currentProgress, nextProgress } = useMemo(() => {
    if (!timeline.length) {
      return { currentLine: null as any, nextLine: null as any, currentProgress: 0, nextProgress: 0 };
    }

    const activeIndex = findActiveIndex(timeline, state.position);
    const current = activeIndex >= 0 ? timeline[activeIndex] : null;
    const next = activeIndex >= 0 && activeIndex + 1 < timeline.length ? timeline[activeIndex + 1] : null;

    if (!current) {
      return { currentLine: null, nextLine: next, currentProgress: 0, nextProgress: 0 };
    }

    if (current.kind === "ellipsis") {
      return { currentLine: current, nextLine: next, currentProgress: 0, nextProgress: 0 };
    }

    const startTime = current.t;
    const endTime = next?.t ?? (startTime + 3);
    const elapsed = state.position - startTime;
    const duration = endTime - startTime;
    const currProg = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1;

    let nextProg = 0;
    if (next && next.kind === "lyric") {
      const nextDuration = next.t - startTime;
      nextProg = nextDuration > 0 ? Math.min(1, Math.max(0, elapsed / nextDuration)) : 0;
    }

    return { currentLine: current, nextLine: next, currentProgress: currProg, nextProgress: nextProg };
  }, [timeline, state.position]);

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

  const dots = formatEllipsisDots(dotCount);

  return (
    <div
      className="fixed bottom-0 left-14 right-0 z-20 border-t border-white/20 shadow-2xl"
      style={bgStyle}
    >
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
        <div 
          className="h-full bg-white/95 transition-all duration-100 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="px-4 py-3 flex items-center gap-6">
        {/* Album Art & Info */}
        <div className="flex items-center gap-4 flex-1 min-w-0 max-w-md">
          {track.coverUrl && (
            <img 
              src={track.coverUrl} 
              alt={track.title}
              className="w-14 h-14 rounded-xl shadow-2xl object-cover flex-shrink-0 ring-2 ring-white/20"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-bold text-white truncate text-base drop-shadow-lg">
              {track.title}
            </div>
            <div className="text-white/90 truncate text-sm drop-shadow-md">
              {track.artist}
            </div>
          </div>
        </div>

        {/* Lyrics Display - Two Lines */}
        {timeline.length > 0 && (
          <div className="flex-1 min-w-0 max-w-2xl">
            {/* Current line */}
            {currentLine && currentLine.kind === "lyric" ? (
              <div className="relative mb-1">
                {/* Background text */}
                <div className="text-white/40 text-sm font-semibold truncate">
                  {currentLine.text}
                </div>
                {/* Filled text */}
                <div 
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${(1 - currentProgress) * 100}% 0 0)` }}
                >
                  <div className="text-white text-sm font-semibold truncate drop-shadow-lg">
                    {currentLine.text}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-white/40 text-sm font-semibold mb-1">
                {state.isPlaying ? dots : ""}
              </div>
            )}
            
            {/* Next line with subtle fill */}
            {nextLine && nextLine.kind === "lyric" ? (
              <div className="relative">
                {/* Background text */}
                <div className="text-white/25 text-xs font-medium truncate">
                  {nextLine.text}
                </div>
                {/* Subtle pre-fill animation */}
                <div 
                  className="absolute inset-0 overflow-hidden opacity-60"
                  style={{ clipPath: `inset(0 ${(1 - nextProgress * 0.3) * 100}% 0 0)` }}
                >
                  <div className="text-white/50 text-xs font-medium truncate">
                    {nextLine.text}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-white/20 text-xs font-medium">
                {state.isPlaying ? "♪" : ""}
              </div>
            )}
          </div>
        )}

        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 hover:bg-white/20 text-white hover:text-white shadow-lg"
            onClick={() => player.previous()}
          >
            <SkipBack className="h-4 w-4 drop-shadow" />
          </Button>

          <Button
            onClick={() => player.togglePlay()}
            size="icon"
            className="h-11 w-11 rounded-full bg-white hover:bg-white/90 text-black hover:scale-110 transition-all shadow-2xl"
          >
            {state.isPlaying ? (
              <Pause className="h-5 w-5 fill-current" />
            ) : (
              <Play className="h-5 w-5 fill-current ml-0.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 hover:bg-white/20 text-white hover:text-white shadow-lg"
            onClick={() => player.next()}
          >
            <SkipForward className="h-4 w-4 drop-shadow" />
          </Button>
        </div>

        {/* Time & Fullscreen */}
        <div className="flex items-center gap-4">
          <div className="text-sm text-white font-mono min-w-[5rem] text-right drop-shadow-lg">
            {formatTime(state.position)} / {formatTime(state.duration)}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => player.setFullscreen(true)}
            className="h-9 w-9 hover:bg-white/20 text-white hover:text-white shadow-lg"
          >
            <Maximize2 className="h-5 w-5 drop-shadow" />
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
