import React, { useEffect, useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import { usePlayer } from "../hooks/usePlayer";
import { Button } from "./ui/button";
import { LyricsOverlay, type LyricsOverlayTrack } from "./LyricsOverlay";
import { useLyrics } from "../hooks/useLyrics";

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

async function getPaletteFromImage(url?: string) {
  if (!url) return null;
  return new Promise<{ a: string; b: string; c: string } | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = 64;
        const h = 64;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;

        // simple palette: average + two quadrant averages
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        let r1 = 0,
          g1 = 0,
          b1 = 0,
          n1 = 0;
        let r2 = 0,
          g2 = 0,
          b2 = 0,
          n2 = 0;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const rr = data[i] || 0;
            const gg = data[i + 1] || 0;
            const bb = data[i + 2] || 0;
            const aa = data[i + 3] || 0;
            if (aa < 16) continue;

            r += rr;
            g += gg;
            b += bb;
            n++;

            if (x < w / 2 && y < h / 2) {
              r1 += rr;
              g1 += gg;
              b1 += bb;
              n1++;
            }
            if (x >= w / 2 && y >= h / 2) {
              r2 += rr;
              g2 += gg;
              b2 += bb;
              n2++;
            }
          }
        }

        const avg = (rr: number, gg: number, bb: number, nn: number) => {
          if (!nn) return "rgba(40,40,40,1)";
          const rrr = Math.round(rr / nn);
          const ggg = Math.round(gg / nn);
          const bbb = Math.round(bb / nn);
          return `rgba(${rrr},${ggg},${bbb},1)`;
        };

        resolve({
          a: avg(r, g, b, n),
          b: avg(r1, g1, b1, n1),
          c: avg(r2, g2, b2, n2),
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function FullScreenPlayer() {
  const { state, player } = usePlayer();
  const track = state.current;

  const lyrics = useLyrics();
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsTrack, setLyricsTrack] = useState<LyricsOverlayTrack | null>(null);

  const [palette, setPalette] = useState<{ a: string; b: string; c: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getPaletteFromImage(track?.coverUrl).then((p) => {
      if (!alive) return;
      setPalette(p);
    });
    return () => {
      alive = false;
    };
  }, [track?.coverUrl]);

  const bgStyle = useMemo(() => {
    const a = palette?.a ?? "rgba(10,10,12,1)";
    const b = palette?.b ?? "rgba(30,30,40,1)";
    const c = palette?.c ?? "rgba(60,30,80,1)";
    return {
      backgroundImage: `radial-gradient(1200px circle at 20% 20%, ${b} 0%, rgba(0,0,0,0) 60%), radial-gradient(1000px circle at 80% 10%, ${c} 0%, rgba(0,0,0,0) 55%), radial-gradient(1400px circle at 50% 90%, ${a} 0%, rgba(0,0,0,0) 65%), linear-gradient(180deg, rgba(8,8,10,1), rgba(0,0,0,1))`,
    } as React.CSSProperties;
  }, [palette]);

  if (!state.isFullscreen || !track) return null;

  const progress = state.duration > 0 ? clamp01(state.position / state.duration) : 0;

  return (
    <div className="fixed inset-0 z-50 text-white" style={bgStyle}>
      <div className="absolute inset-0 overflow-hidden">
        {/* floating shapes */}
        <div className="absolute -top-20 -left-20 h-[320px] w-[320px] rounded-full bg-white/10 blur-3xl animate-[spin_24s_linear_infinite]" />
        <div className="absolute top-40 -right-20 h-[260px] w-[260px] rounded-full bg-white/10 blur-3xl animate-[spin_30s_linear_infinite]" />
        <div className="absolute -bottom-24 left-1/3 h-[360px] w-[360px] rounded-full bg-white/10 blur-3xl animate-[spin_36s_linear_infinite]" />
      </div>

      {lyricsTrack ? (
        <LyricsOverlay
          open={lyricsOpen}
          onOpenChange={setLyricsOpen}
          track={lyricsTrack}
          ensureLyricsFile={lyrics.ensureLyricsFile}
          loadLyrics={lyrics.loadLyrics}
        />
      ) : null}

      <div className="relative mx-auto flex h-full max-w-5xl flex-col px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="text-sm opacity-80">Now Playing</div>
          <div className="flex items-center gap-2">
            {track.spotifyId ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setLyricsTrack({ spotify_id: track.spotifyId, name: track.title, artists: track.artist });
                  setLyricsOpen(true);
                }}
              >
                <FileText className="h-4 w-4" />
                Lyrics
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" onClick={() => player.setFullscreen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-2 md:items-center">
          <div className="mx-auto w-full max-w-md">
            <div className="aspect-square overflow-hidden rounded-2xl bg-black/30 shadow-2xl">
              {track.coverUrl ? (
                <img src={track.coverUrl} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full" />
              )}
            </div>
          </div>

          <div>
            <div className="text-3xl font-semibold leading-tight">{track.title}</div>
            <div className="mt-2 text-lg opacity-85">{track.artist}</div>
            {track.album ? <div className="mt-1 text-sm opacity-70">{track.album}</div> : null}

            <div className="mt-8">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                <div className="h-full bg-white/70" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs opacity-70">
                <span>{formatTime(state.position)}</span>
                <span>{formatTime(state.duration)}</span>
              </div>
            </div>

            <div className="mt-8 flex items-center gap-3">
              <Button onClick={() => player.togglePlay()}>{state.isPlaying ? "Pause" : "Play"}</Button>
              <Button variant="secondary" onClick={() => player.seek(Math.max(0, state.position - 10))}>
                -10s
              </Button>
              <Button variant="secondary" onClick={() => player.seek(state.position + 10)}>
                +10s
              </Button>
            </div>

            <div className="mt-8">
              <div className="text-xs opacity-70">Volume</div>
              <input
                className="mt-2 w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={state.volume}
                onChange={(e) => player.setVolume(Number(e.target.value))}
              />
            </div>

            <div className="mt-8 rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="text-sm font-medium">EQ (skeleton)</div>
              <div className="mt-2 text-xs opacity-70">
                Next step: wire WebAudio equalizer + presets + limiter.
              </div>
            </div>
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
