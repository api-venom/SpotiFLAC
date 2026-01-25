import { GetStreamURL } from "../../wailsjs/go/main/App";
import { logger } from "@/lib/logger";
import { getSettings } from "@/lib/settings";

// Type definitions for MPV methods (will be dynamically checked at runtime)
type MPVMethods = {
  MPVLoadTrack?: (url: string, headers: Record<string, string>) => Promise<void>;
  MPVPlay?: () => Promise<void>;
  MPVPause?: () => Promise<void>;
  MPVStop?: () => Promise<void>;
  MPVSeek?: (seconds: number) => Promise<void>;
  MPVSetVolume?: (volume: number) => Promise<void>;
  MPVSetEqualizer?: (presetName: string, bands: Record<string, number>, preamp: number) => Promise<void>;
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
      MPVSetEqualizer: appModule.MPVSetEqualizer,
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

export type RepeatMode = "off" | "all" | "one";

type InternalState = {
  current?: PlayerTrack;
  isPlaying: boolean;
  duration: number;
  position: number;
  volume: number;
  isFullscreen: boolean;
  useMPV: boolean; // Whether to use MPV backend or HTML5 audio

  queue: PlayerTrack[];
  queueIndex: number; // -1 when no queue
  shuffle: boolean;
  repeat: RepeatMode;
};

type Listener = (s: InternalState) => void;

class PlayerService {
  private audio: HTMLAudioElement;
  private state: InternalState;
  private listeners = new Set<Listener>();
  private mpvStatusInterval?: ReturnType<typeof setInterval>;
  private queueBase: PlayerTrack[] = [];
  private lastMPVState: string | null = null;

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
      useMPV: false, // Will be auto-detected

      queue: [],
      queueIndex: -1,
      shuffle: false,
      repeat: "off",
    };
    
    // Auto-detect MPV availability and prefer it for better audio quality (EQ, etc.)
    this.initializeMPVPreference();

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
      // HTML5 ended event is a reliable place to auto-advance.
      this.handleEnded().catch(() => {
        this.state.isPlaying = false;
        this.emit();
      });
    });
  }

  private emitWithQueueDerivedState() {
    // Ensure invariants.
    if (this.state.queueIndex >= this.state.queue.length) {
      this.state.queueIndex = this.state.queue.length - 1;
    }
    if (this.state.queueIndex < -1) {
      this.state.queueIndex = -1;
    }
    this.emit();
  }

  private buildQueueFromBase(startIndex: number, shuffle: boolean): { queue: PlayerTrack[]; index: number } {
    const base = this.queueBase.slice();
    if (base.length === 0) {
      return { queue: [], index: -1 };
    }

    const safeStart = Math.min(Math.max(0, startIndex), base.length - 1);
    if (!shuffle) {
      return { queue: base, index: safeStart };
    }

    // Shuffle while keeping the selected track as the first play item.
    const start = base[safeStart];
    const rest = base.filter((_, i) => i !== safeStart);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = rest[i];
      rest[i] = rest[j];
      rest[j] = tmp;
    }
    return { queue: [start, ...rest], index: 0 };
  }

  private async playNow(track: PlayerTrack, opts?: { audioFormat?: string; downloadDir?: string }) {
    this.state.current = track;
    this.emitWithQueueDerivedState();
    await this.playTrackInternal(track, opts);
  }

  private async handleEnded() {
    if (this.state.repeat === "one" && this.state.current) {
      // Restart current track.
      this.seek(0);
      if (!this.state.isPlaying) {
        await this.togglePlay();
      }
      return;
    }

    const hasQueue = this.state.queueIndex >= 0 && this.state.queue.length > 0;
    if (!hasQueue) {
      this.state.isPlaying = false;
      this.emitWithQueueDerivedState();
      return;
    }

    const nextIndex = this.state.queueIndex + 1;
    if (nextIndex < this.state.queue.length) {
      await this.playAtIndex(nextIndex);
      return;
    }

    if (this.state.repeat === "all" && this.state.queue.length > 0) {
      await this.playAtIndex(0);
      return;
    }

    this.state.isPlaying = false;
    this.emitWithQueueDerivedState();
  }

  private async playAtIndex(index: number, opts?: { audioFormat?: string; downloadDir?: string }) {
    if (this.state.queue.length === 0) return;
    const i = Math.min(Math.max(0, index), this.state.queue.length - 1);
    const track = this.state.queue[i];
    if (!track) return;

    this.state.queueIndex = i;
    await this.playNow(track, opts);
  }
  
  private async initializeMPVPreference() {
    // Check if MPV is available
    try {
      const methods = await getMPVMethods();
      const hasMPV = methods.MPVLoadTrack && methods.MPVPlay && methods.MPVGetStatus;
      
      if (hasMPV) {
        logger.info("MPV player detected - using as default for better audio quality (EQ support)", "player");
        this.state.useMPV = true;
        this.emit();
      } else {
        logger.info("MPV not available - using HTML5 audio", "player");
      }
    } catch (err) {
      logger.debug("MPV initialization check failed, using HTML5 audio", "player");
    }
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

    // Poll MPV status every 50ms for smooth lyrics sync
    this.mpvStatusInterval = setInterval(async () => {
      if (!this.state.useMPV) {
        return;
      }

      try {
        const methods = await getMPVMethods();
        if (!methods.MPVGetStatus) return;
        
        const status = await methods.MPVGetStatus();

        const prevState = this.lastMPVState;
        this.lastMPVState = status.state || null;
        
        // Update state from MPV status
        this.state.isPlaying = status.state === "playing";
        this.state.position = status.position_sec || 0;
        this.state.duration = status.duration_sec || 0;
        this.state.volume = (status.volume || 100) / 100;

        this.emitWithQueueDerivedState();

        // Auto-advance when MPV transitions from playing->stopped near EOF.
        if (
          prevState === "playing" &&
          status.state === "stopped" &&
          this.state.duration > 0 &&
          this.state.position >= Math.max(0, this.state.duration - 0.25)
        ) {
          this.handleEnded().catch(() => {});
        }
      } catch (err) {
        // Silently fail - MPV might not be initialized yet
      }
    }, 50);
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

      const settings = getSettings();
      const url = await GetStreamURL({
        spotify_id: track.spotifyId,
        isrc: track.isrc || "",
        track_name: track.title,
        artist_name: track.artist,
        album_name: track.album || "",
        audio_format: opts?.audioFormat || "LOSSLESS",
        download_dir: opts?.downloadDir || "",
        provider: settings.downloader || "auto",
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

  private async playTrackInternal(track: PlayerTrack, opts?: { audioFormat?: string; downloadDir?: string }) {

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
      // Prefer a format the current WebView can actually decode.
      // Many WebViews (notably macOS WKWebView) can't decode FLAC reliably.
      const canFlac = this.audio.canPlayType("audio/flac");
      const defaultHtml5Format = canFlac ? "LOSSLESS" : "HIGH"; // HIGH maps to AAC for Tidal

      const settings = getSettings();
      const url = await GetStreamURL({
        spotify_id: track.spotifyId,
        isrc: track.isrc || "",
        track_name: track.title,
        artist_name: track.artist,
        album_name: track.album || "",
        audio_format: opts?.audioFormat || defaultHtml5Format,
        download_dir: opts?.downloadDir || "",
        provider: settings.downloader || "auto",
      } as any);

      logger.success(`stream url: ${url}`, "player");

      // Quick capability checks (most important for FLAC/hi-res).
      // If the WebView can't decode the MIME/container, it will throw NotSupportedError.
      const canOgg = this.audio.canPlayType('audio/ogg; codecs="vorbis"');
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

  async playTrack(track: PlayerTrack, opts?: { audioFormat?: string; downloadDir?: string }) {
    // Single-track play: resets the queue to just this track.
    this.queueBase = [track];
    this.state.shuffle = false;
    this.state.queue = [track];
    this.state.queueIndex = 0;
    await this.playNow(track, opts);
  }

  async setQueue(tracks: PlayerTrack[], startIndex: number, opts?: { shuffle?: boolean; audioFormat?: string; downloadDir?: string }) {
    const cleaned = (tracks || []).filter((t) => t && t.spotifyId);
    this.queueBase = cleaned;
    const shuffle = Boolean(opts?.shuffle);
    const built = this.buildQueueFromBase(startIndex, shuffle);
    this.state.shuffle = shuffle;
    this.state.queue = built.queue;
    this.state.queueIndex = built.index;
    const current = this.state.queue[this.state.queueIndex];
    if (current) {
      await this.playNow(current, { audioFormat: opts?.audioFormat, downloadDir: opts?.downloadDir });
    } else {
      this.emitWithQueueDerivedState();
    }
  }

  async next() {
    if (this.state.repeat === "one" && this.state.current) {
      this.seek(0);
      return;
    }
    if (this.state.queue.length === 0 || this.state.queueIndex < 0) return;
    const nextIndex = this.state.queueIndex + 1;
    if (nextIndex < this.state.queue.length) {
      await this.playAtIndex(nextIndex);
      return;
    }
    if (this.state.repeat === "all" && this.state.queue.length > 0) {
      await this.playAtIndex(0);
    }
  }

  async previous() {
    // Common UX: if you're more than a couple seconds in, restart current.
    if (this.state.position > 3) {
      this.seek(0);
      return;
    }
    if (this.state.queue.length === 0 || this.state.queueIndex < 0) {
      this.seek(0);
      return;
    }
    const prevIndex = this.state.queueIndex - 1;
    if (prevIndex >= 0) {
      await this.playAtIndex(prevIndex);
      return;
    }
    this.seek(0);
  }

  async jumpToQueueIndex(index: number) {
    if (this.state.queue.length === 0 || index < 0 || index >= this.state.queue.length) return;
    await this.playAtIndex(index);
  }

  clearQueue() {
    this.state.queue = [];
    this.state.queueIndex = -1;
    this.queueBase = [];
    this.emit();
  }

  toggleShuffle() {
    if (this.queueBase.length <= 1) {
      this.state.shuffle = !this.state.shuffle;
      this.emitWithQueueDerivedState();
      return;
    }

    const current = this.state.current;
    const currentBaseIndex = current
      ? this.queueBase.findIndex((t) => t.spotifyId === current.spotifyId)
      : 0;

    const nextShuffle = !this.state.shuffle;
    const built = this.buildQueueFromBase(Math.max(0, currentBaseIndex), nextShuffle);
    this.state.shuffle = nextShuffle;
    this.state.queue = built.queue;
    this.state.queueIndex = built.index;
    this.emitWithQueueDerivedState();
  }

  cycleRepeat() {
    this.state.repeat = this.state.repeat === "off" ? "all" : this.state.repeat === "all" ? "one" : "off";
    this.emitWithQueueDerivedState();
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
  
  // Set audio equalizer (only works with MPV backend)
  // bands: frequency in Hz -> gain in dB, e.g. { "1000": 2.5, "2000": -1.0 }
  // preamp: pre-amplification gain in dB (applied to all bands)
  async setEqualizer(presetName: string, bands: Record<string, number>, preamp: number = 0) {
    if (!this.state.useMPV) {
      throw new Error("Equalizer is only available with MPV backend");
    }
    
    const methods = await getMPVMethods();
    if (!methods.MPVSetEqualizer) {
      throw new Error("MPV equalizer method not available");
    }
    
    await methods.MPVSetEqualizer(presetName, bands, preamp);
    logger.info(`Equalizer set: ${presetName} (preamp: ${preamp}dB)`, "player");
  }
}

export const player = new PlayerService();
