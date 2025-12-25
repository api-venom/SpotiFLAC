import { Play, Pause, SkipBack, SkipForward, Maximize2 } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/hooks/usePlayer";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    if (track?.coverUrl) {
      extractDominantColor(track.coverUrl).then(setBgColor);
    } else {
      setBgColor(null);
    }
  }, [track?.coverUrl]);

  if (!track || state.isFullscreen) return null;

  const progress = state.duration > 0 ? clamp01(state.position / state.duration) : 0;

  const bgStyle = bgColor 
    ? {
        background: `linear-gradient(135deg, ${bgColor}dd 0%, ${bgColor}aa 50%, ${bgColor}88 100%)`,
      }
    : {
        background: "linear-gradient(135deg, rgba(30, 30, 40, 0.95) 0%, rgba(20, 20, 30, 0.95) 100%)",
      };

  return (
    <div 
      className="fixed top-10 left-14 right-0 z-40 border-b border-white/10 backdrop-blur-xl"
      style={bgStyle}
    >
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
        <div 
          className="h-full bg-white/90 transition-all duration-200"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="px-4 py-2 flex items-center gap-4">
        {/* Album Art & Info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {track.coverUrl && (
            <img 
              src={track.coverUrl} 
              alt={track.title}
              className="w-12 h-12 rounded-lg shadow-lg object-cover flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white truncate text-sm">
              {track.title}
            </div>
            <div className="text-white/70 truncate text-xs">
              {track.artist}
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-white/10 text-white/90 hover:text-white"
          >
            <SkipBack className="h-4 w-4" />
          </Button>

          <Button
            onClick={() => player.togglePlay()}
            size="icon"
            className="h-9 w-9 rounded-full bg-white hover:bg-white/90 text-black hover:scale-105 transition-all shadow-lg"
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
            className="h-8 w-8 hover:bg-white/10 text-white/90 hover:text-white"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Time & Fullscreen */}
        <div className="flex items-center gap-4">
          <div className="text-xs text-white/70 font-mono min-w-[4rem] text-right">
            {formatTime(state.position)} / {formatTime(state.duration)}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => player.setFullscreen(true)}
            className="h-8 w-8 hover:bg-white/10 text-white/70 hover:text-white"
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
