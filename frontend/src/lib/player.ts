import { GetStreamURL } from "../../wailsjs/go/main/App";
import { logger } from "@/lib/logger";

// Type definitions for MPV methods (will be dynamically checked at runtime)
type MPVMethods = {
  MPVLoadTrack?: (url: string, headers: Record<string, string>) => Promise<void>;
  MPVPlay?: () => Promise<void>;
  MPVPause?: () => Promise<void>;
  MPVStop?: () => Promise<void>;
  MPVSeek?: (seconds: number) => Promise<void>;
  MPVSetVolume?: (volume: number) => Promise<void>;
  MPVGetStatus?: () => Promise<any>;
};

// Lazy-load MPV methods
let mpvMethods: MPVMethods | null = null;
let mpvMethodsChecked = false;

async function getMPVMethods(): Promise<MPVMethods> {
  if (mpvMethods) return mpvMethods;
  if (mpvMethodsChecked) return {};
  
  mpvMethodsChecked = true;
  try {
    // @ts-ignore - Wails bindings are generated at build time
    const appModule = await import("../../wailsjs/go/main/App");
    mpvMethods = {
      // @ts-ignore - MPV methods may not exist in stub builds
      MPVLoadTrack: appModule.MPVLoadTrack,
      // @ts-ignore
      MPVPlay: appModule.MPVPlay,
      // @ts-ignore
      MPVPause: appModule.MPVPause,
      // @ts-ignore
      MPVStop: appModule.MPVStop,
      // @ts-ignore
      MPVSeek: appModule.MPVSeek,
      // @ts-ignore
      MPVSetVolume: appModule.MPVSetVolume,
      // @ts-ignore
      MPVGetStatus: appModule.MPVGetStatus,
    };
    
    // Check if methods actually exist
    const hasLoad = typeof mpvMethods.MPVLoadTrack === 'function';
    const hasPlay = typeof mpvMethods.MPVPlay === 'function';
    const hasStatus = typeof mpvMethods.MPVGetStatus === 'function';
    
    logger.debug(
      `MPV methods check: MPVLoadTrack=${hasLoad} MPVPlay=${hasPlay} MPVGetStatus=${hasStatus}`,
      "player"
    );
    
    if (!hasLoad || !hasPlay) {
      logger.error("MPV methods found in module but are undefined (stub build?)", "player");
      mpvMethods = {};
      return {};
    }
    
    logger.debug("MPV methods loaded successfully", "player");
    return mpvMethods;
  } catch (e) {
    logger.debug("MPV methods not available, using HTML5 audio only", "player");
    return {};
  }
}

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
  useMPV: boolean; // Whether to use MPV backend or HTML5 audio
};

type Listener = (s: InternalState) => void;

class PlayerService {
  private audio: HTMLAudioElement;
  private state: InternalState;
  private listeners = new Set<Listener>();
  private mpvStatusInterval?: ReturnType<typeof setInterval>;

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
      
      // If HTML5 audio fails, automatically switch to MPV
      if (code === 4 && !this.state.useMPV) {
        logger.info("HTML5 audio not supported, switching to MPV backend", "player");
        this.switchToMPV();
      }
    });

    this.state = {
      isPlaying: false,
      duration: 0,
      position: 0,
      volume: 1,
      isFullscreen: false,
      useMPV: false, // Try HTML5 audio first
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

  private async switchToMPV() {
    logger.info("Switching to MPV backend for playback", "player");
    this.state.useMPV = true;
    this.emit();
    
    // If we have a current track, replay it with MPV
    if (this.state.current) {
      const track = this.state.current;
      const currentPos = this.state.position;
      
      try {
        await this.playTrackWithMPV(track, {});
        
        // Restore position if we had one
        if (currentPos > 0) {
          const methods = await getMPVMethods();
          if (methods.MPVSeek) {
            await methods.MPVSeek(currentPos);
          }
        }
      } catch (err) {
        logger.exception(err, "Failed to switch to MPV", "player");
      }
    }
  }

  private startMPVStatusPolling() {
    // Stop any existing polling
    if (this.mpvStatusInterval) {
      clearInterval(this.mpvStatusInterval);
    }

    // Poll MPV status every 200ms
    this.mpvStatusInterval = setInterval(async () => {
      if (!this.state.useMPV) {
        return;
      }

      try {
        const methods = await getMPVMethods();
        if (!methods.MPVGetStatus) return;
        
        const status = await methods.MPVGetStatus();
        
        // Update state from MPV status
        this.state.isPlaying = status.state === "playing";
        this.state.position = status.position_sec || 0;
        this.state.duration = status.duration_sec || 0;
        this.state.volume = (status.volume || 100) / 100;
        
        this.emit();
      } catch (err) {
        // Silently fail - MPV might not be initialized yet
      }
    }, 200);
  }

  private stopMPVStatusPolling() {
    if (this.mpvStatusInterval) {
      clearInterval(this.mpvStatusInterval);
      this.mpvStatusInterval = undefined;
    }
  }

  private async playTrackWithMPV(track: PlayerTrack, opts?: { audioFormat?: string; downloadDir?: string }) {
    try {
      const methods = await getMPVMethods();
      if (!methods.MPVLoadTrack || !methods.MPVPlay) {
        throw new Error("MPV methods not available");
      }

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

      // Load track into MPV
      await methods.MPVLoadTrack(url, {});
      logger.success("MPV track loaded", "player");

      // Start playback
      await methods.MPVPlay();
      logger.success("MPV playback started", "player");

      // Start polling for status updates
      this.startMPVStatusPolling();

    } catch (err) {
      this.stopMPVStatusPolling();
      throw err;
    }
  }

  async playTrack(track: PlayerTrack, opts?: { audioFormat?: string; downloadDir?: string }) {
    this.state.current = track;
    this.emit();

    logger.info(`play: ${track.title} - ${track.artist}`, "player");
    logger.debug(`spotifyId=${track.spotifyId} isrc=${track.isrc || ""}`, "player");

    // If MPV mode is enabled, use MPV backend
    if (this.state.useMPV) {
      try {
        await this.playTrackWithMPV(track, opts);
        return;
      } catch (err) {
        logger.exception(err, "MPV playback failed", "player");
        // Fall back to HTML5 audio
        logger.info("Falling back to HTML5 audio", "player");
        this.state.useMPV = false;
        this.stopMPVStatusPolling();
      }
    }

    // Try HTML5 audio element
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
      
      // If HTML5 fails and we haven't tried MPV yet, try MPV
      if (!this.state.useMPV) {
        logger.info("HTML5 playback failed, trying MPV backend", "player");
        this.state.useMPV = true;
        this.emit();
        
        try {
          await this.playTrackWithMPV(track, opts);
          return;
        } catch (mpvErr) {
          logger.exception(mpvErr, "MPV playback also failed", "player");
          this.state.useMPV = false;
          this.stopMPVStatusPolling();
        }
      }
      
      throw err;
    }
  }

  async togglePlay() {
    if (!this.state.current) return;
    
    try {
      if (this.state.useMPV) {
        // Use MPV backend
        const methods = await getMPVMethods();
        if (this.state.isPlaying) {
          if (methods.MPVPause) {
            await methods.MPVPause();
            logger.debug("togglePlay -> pause (MPV)", "player");
          }
        } else {
          if (methods.MPVPlay) {
            await methods.MPVPlay();
            logger.debug("togglePlay -> play (MPV)", "player");
          }
        }
      } else {
        // Use HTML5 audio
        if (this.audio.paused) {
          await this.audio.play();
          logger.debug("togglePlay -> play", "player");
        } else {
          this.audio.pause();
          logger.debug("togglePlay -> pause", "player");
        }
      }
    } catch (err) {
      logger.exception(err, "togglePlay failed", "player");
    }
  }

  seek(seconds: number) {
    if (this.state.useMPV) {
      // Use MPV backend
      getMPVMethods().then((methods) => {
        if (methods.MPVSeek) {
          methods.MPVSeek(Math.max(0, seconds)).catch((err: any) => {
            logger.exception(err, "MPV seek failed", "player");
          });
        }
      });
      this.state.position = Math.max(0, seconds);
      this.emit();
    } else {
      // Use HTML5 audio
      this.audio.currentTime = Math.max(0, seconds);
      this.state.position = this.audio.currentTime;
      this.emit();
    }
  }

  setVolume(v: number) {
    const nv = Math.min(1, Math.max(0, v));
    this.state.volume = nv;
    
    if (this.state.useMPV) {
      // Use MPV backend (volume is 0-100)
      getMPVMethods().then((methods) => {
        if (methods.MPVSetVolume) {
          methods.MPVSetVolume(nv * 100).catch((err: any) => {
            logger.exception(err, "MPV setVolume failed", "player");
          });
        }
      });
    } else {
      // Use HTML5 audio
      this.audio.volume = nv;
    }
    
    this.emit();
  }

  // Manual toggle between HTML5 and MPV
  async setUseMPV(enabled: boolean) {
    if (this.state.useMPV === enabled) return;
    
    const wasPlaying = this.state.isPlaying;
    const currentPos = this.state.position;
    const currentTrack = this.state.current;
    
    if (enabled) {
      // Switch to MPV
      this.audio.pause();
      this.state.useMPV = true;
      this.emit();
      
      if (currentTrack) {
        try {
          await this.playTrackWithMPV(currentTrack, {});
          const methods = await getMPVMethods();
          if (currentPos > 0 && methods.MPVSeek) {
            await methods.MPVSeek(currentPos);
          }
          if (!wasPlaying && methods.MPVPause) {
            await methods.MPVPause();
          }
        } catch (err) {
          logger.exception(err, "Failed to switch to MPV", "player");
          this.state.useMPV = false;
          this.stopMPVStatusPolling();
          this.emit();
        }
      }
    } else {
      // Switch to HTML5
      const methods = await getMPVMethods();
      if (methods.MPVStop) {
        await methods.MPVStop().catch(() => {});
      }
      this.stopMPVStatusPolling();
      this.state.useMPV = false;
      this.emit();
      
      if (currentTrack) {
        try {
          await this.playTrack(currentTrack, {});
          if (currentPos > 0) {
            this.audio.currentTime = currentPos;
          }
          if (!wasPlaying) {
            this.audio.pause();
          }
        } catch (err) {
          logger.exception(err, "Failed to switch to HTML5", "player");
        }
      }
    }
  }
}

export const player = new PlayerService();
