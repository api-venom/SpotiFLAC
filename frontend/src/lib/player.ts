import { GetStreamURL } from "../../wailsjs/go/main/App";
import { logger } from "@/lib/logger";

export type PlayerTrack = {
  spotifyId: string;
  isrc?: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
};

type InternalState = {
  current?: PlayerTrack;
  isPlaying: boolean;
  duration: number;
  position: number;
  volume: number;
  isFullscreen: boolean;
};

type Listener = (s: InternalState) => void;

class PlayerService {
  private audio: HTMLAudioElement;
  private state: InternalState;
  private listeners = new Set<Listener>();

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";

    // Helpful diagnostics for when the underlying WebView/audio pipeline can't decode the stream.
    this.audio.addEventListener("error", () => {
      const mediaError = this.audio.error;
      const code = mediaError?.code ?? 0;
      const msg =
        code === 1
          ? "MEDIA_ERR_ABORTED"
          : code === 2
            ? "MEDIA_ERR_NETWORK"
            : code === 3
              ? "MEDIA_ERR_DECODE"
              : code === 4
                ? "MEDIA_ERR_SRC_NOT_SUPPORTED"
                : "MEDIA_ERR_UNKNOWN";

      logger.error(
        `audio error: code=${code} (${msg}) src=${this.audio.currentSrc || this.audio.src}`,
        "player",
      );
    });

    this.state = {
      isPlaying: false,
      duration: 0,
      position: 0,
      volume: 1,
      isFullscreen: false,
    };

    this.audio.addEventListener("loadedmetadata", () => {
      this.state.duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
      this.emit();
    });
    this.audio.addEventListener("timeupdate", () => {
      this.state.position = this.audio.currentTime || 0;
      this.emit();
    });
    this.audio.addEventListener("play", () => {
      this.state.isPlaying = true;
      this.emit();
    });
    this.audio.addEventListener("pause", () => {
      this.state.isPlaying = false;
      this.emit();
    });
    this.audio.addEventListener("ended", () => {
      this.state.isPlaying = false;
      this.emit();
    });
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l({ ...this.state });
  }

  getState() {
    return { ...this.state };
  }

  setFullscreen(v: boolean) {
    this.state.isFullscreen = v;
    this.emit();
  }

  async playTrack(track: PlayerTrack, opts?: { audioFormat?: string; downloadDir?: string }) {
    this.state.current = track;
    this.emit();

    logger.info(`play: ${track.title} - ${track.artist}`, "player");
    logger.debug(`spotifyId=${track.spotifyId} isrc=${track.isrc || ""}`, "player");

    try {
      const url = await GetStreamURL({
        spotify_id: track.spotifyId,
        isrc: track.isrc || "",
        track_name: track.title,
        artist_name: track.artist,
        album_name: track.album || "",
        audio_format: opts?.audioFormat || "LOSSLESS",
        download_dir: opts?.downloadDir || "",
      } as any);

      logger.success(`stream url: ${url}`, "player");

      // Quick capability checks (most important for FLAC/hi-res).
      // If the WebView can't decode the MIME/container, it will throw NotSupportedError.
      const canOgg = this.audio.canPlayType('audio/ogg; codecs="vorbis"');
      const canFlac = this.audio.canPlayType("audio/flac");
      const canMp3 = this.audio.canPlayType("audio/mpeg");
      logger.debug(`canPlayType: flac=${canFlac} mp3=${canMp3} ogg=${canOgg}`, "player");

      this.audio.src = url;
      this.audio.currentTime = 0;
      this.audio.volume = this.state.volume;

      await this.audio.play();
      logger.success("audio.play() ok", "player");
    } catch (err) {
      logger.exception(err, "playTrack failed", "player");
      throw err;
    }
  }

  async togglePlay() {
    if (!this.state.current) return;
    try {
      if (this.audio.paused) {
        await this.audio.play();
        logger.debug("togglePlay -> play", "player");
      } else {
        this.audio.pause();
        logger.debug("togglePlay -> pause", "player");
      }
    } catch (err) {
      logger.exception(err, "togglePlay failed", "player");
    }
  }

  seek(seconds: number) {
    this.audio.currentTime = Math.max(0, seconds);
    this.state.position = this.audio.currentTime;
    this.emit();
  }

  setVolume(v: number) {
    const nv = Math.min(1, Math.max(0, v));
    this.state.volume = nv;
    this.audio.volume = nv;
    this.emit();
  }
}

export const player = new PlayerService();
