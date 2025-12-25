import { useMemo, useState } from "react";
import { FileText, X, Heart, MoreHorizontal, Repeat, Shuffle, SkipBack, SkipForward, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { usePlayer } from "../hooks/usePlayer";
import { Button } from "./ui/button";
import { LyricsOverlay, type LyricsOverlayTrack } from "./LyricsOverlay";
import { useLyrics } from "../hooks/useLyrics";
import { cn } from "@/lib/utils";
import { buildPaletteBackgroundStyle } from "@/lib/cover/palette";
import { useCoverPalette } from "@/hooks/useCoverPalette";

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function FullScreenPlayer() {
  const { state, player } = usePlayer();
  const track = state.current;

  const lyrics = useLyrics();
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsTrack, setLyricsTrack] = useState<LyricsOverlayTrack | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);

  const palette = useCoverPalette(track?.coverUrl);

  const bgStyle = useMemo(() => buildPaletteBackgroundStyle(palette), [palette]);

  // Fetch lyrics handler
  const handleFetchLyrics = async (spotifyId: string, trackName: string, artistName: string) => {
    await lyrics.handleDownloadLyrics(spotifyId, trackName, artistName);
  };

  if (!state.isFullscreen || !track) return null;

  const progress = state.duration > 0 ? clamp01(state.position / state.duration) : 0;

  return (
    <div className="fixed inset-0 z-50 text-white overflow-hidden" style={bgStyle}>
      {/* Animated background elements */}
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
      <div className="absolute inset-0 backdrop-blur-3xl bg-black/30" />

      {lyricsTrack ? (
        <LyricsOverlay
          open={lyricsOpen}
          onOpenChange={setLyricsOpen}
          track={lyricsTrack}
          ensureLyricsFile={lyrics.ensureLyricsFile}
          currentPosition={state.position}
          fetchLyrics={handleFetchLyrics}
        />
      ) : null}

      <div className="relative h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 backdrop-blur-sm bg-black/10">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => player.setFullscreen(false)}
              className="hover:bg-white/10 text-white/90 hover:text-white"
            >
              <X className="h-5 w-5" />
            </Button>
            <div>
              <div className="text-xs text-white/60 uppercase tracking-wider">Playing from</div>
              <div className="text-sm font-medium">{track.album || "Library"}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon"
              className="hover:bg-white/10 text-white/70 hover:text-white"
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex items-center justify-center px-8 py-8">
          <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Album Art */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative group">
                <div className="absolute -inset-4 bg-gradient-to-r from-white/5 to-white/10 rounded-3xl blur-2xl opacity-50 group-hover:opacity-70 transition-opacity duration-500" />
                <div className="relative aspect-square w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl">
                  {track.coverUrl ? (
                    <>
                      <img 
                        src={track.coverUrl} 
                        className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700" 
                        alt={track.title}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    </>
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-white/5 to-white/10 flex items-center justify-center">
                      <div className="text-6xl text-white/20">♫</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Track Info & Controls */}
            <div className="flex flex-col justify-center lg:pl-8">
              {/* Track Metadata */}
              <div className="mb-8">
                <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-white/80">
                  {track.title}
                </h1>
                <h2 className="text-2xl md:text-3xl text-white/80 mb-2 font-medium">
                  {track.artist}
                </h2>
                {track.album && (
                  <p className="text-lg text-white/60 flex items-center gap-2">
                    <span>{track.album}</span>
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-4 mb-8">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsFavorite(!isFavorite)}
                  className={cn(
                    "hover:bg-white/10 transition-colors duration-200",
                    isFavorite ? "text-red-500 hover:text-red-400" : "text-white/70 hover:text-white"
                  )}
                >
                  <Heart className={cn("h-6 w-6", isFavorite && "fill-current")} />
                </Button>
                {track.spotifyId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setLyricsTrack({ spotify_id: track.spotifyId, name: track.title, artists: track.artist, coverUrl: track.coverUrl });
                      setLyricsOpen(true);
                    }}
                    className="hover:bg-white/10 text-white/70 hover:text-white"
                  >
                    <FileText className="h-6 w-6" />
                  </Button>
                )}
              </div>

              {/* Progress Bar */}
              <div className="mb-8">
                <div 
                  className="group h-1.5 w-full bg-white/20 rounded-full overflow-hidden cursor-pointer hover:h-2 transition-all duration-200"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const percent = x / rect.width;
                    player.seek(percent * state.duration);
                  }}
                >
                  <div 
                    className="h-full bg-gradient-to-r from-white to-white/90 rounded-full relative group-hover:from-white group-hover:to-white transition-all duration-200"
                    style={{ width: `${progress * 100}%` }}
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg" />
                  </div>
                </div>
                <div className="flex justify-between mt-2 text-sm text-white/60">
                  <span>{formatTime(state.position)}</span>
                  <span>-{formatTime(state.duration - state.position)}</span>
                </div>
              </div>

              {/* Playback Controls */}
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => player.toggleShuffle()}
                    className={cn(
                      "hover:bg-white/10 transition-colors",
                      state.shuffle ? "text-green-400" : "text-white/60 hover:text-white"
                    )}
                  >
                    <Shuffle className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-white/10 text-white/90 hover:text-white"
                    onClick={() => player.previous()}
                  >
                    <SkipBack className="h-6 w-6" />
                  </Button>
                </div>

                <Button
                  onClick={() => player.togglePlay()}
                  size="icon"
                  className="w-16 h-16 rounded-full bg-white hover:bg-white/90 text-black hover:scale-105 transition-all duration-200 shadow-2xl"
                >
                  {state.isPlaying ? (
                    <Pause className="h-8 w-8 fill-current" />
                  ) : (
                    <Play className="h-8 w-8 fill-current ml-1" />
                  )}
                </Button>

                <div className="flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-white/10 text-white/90 hover:text-white"
                    onClick={() => player.next()}
                  >
                    <SkipForward className="h-6 w-6" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => player.cycleRepeat()}
                    className={cn(
                      "hover:bg-white/10 transition-colors",
                      state.repeat !== "off" ? "text-green-400" : "text-white/60 hover:text-white"
                    )}
                  >
                    <Repeat className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              {/* Volume Control */}
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => player.setVolume(state.volume > 0 ? 0 : 1)}
                  className="hover:bg-white/10 text-white/70 hover:text-white flex-shrink-0"
                >
                  {state.volume === 0 ? (
                    <VolumeX className="h-5 w-5" />
                  ) : (
                    <Volume2 className="h-5 w-5" />
                  )}
                </Button>
                <div className="flex-1 max-w-xs">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={state.volume}
                    onChange={(e) => player.setVolume(Number(e.target.value))}
                    className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg hover:[&::-webkit-slider-thumb]:scale-110 [&::-webkit-slider-thumb]:transition-transform"
                  />
                </div>
                <span className="text-sm text-white/60 min-w-[3rem] text-right">
                  {Math.round(state.volume * 100)}%
                </span>
              </div>

              {/* Additional Info */}
              {track.isrc && (
                <div className="mt-6 pt-6 border-t border-white/10">
                  <div className="flex items-center gap-6 text-sm text-white/50">
                    <div>
                      <span className="text-white/40">ISRC:</span> {track.isrc}
                    </div>
                    <div>
                      <span className="text-white/40">Quality:</span> {state.useMPV ? "Hi-Res FLAC" : "High"}
                    </div>
                  </div>
                </div>
              )}
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
