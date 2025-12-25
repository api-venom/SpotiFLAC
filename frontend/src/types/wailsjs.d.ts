// This project relies on Wails-generated bindings under "wailsjs/".
// Those files are generated at build time in CI and may not exist in a fresh checkout.
// These minimal declarations keep TypeScript happy during development and refactors.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "../wailsjs/go/main/App" {
  export function OpenFolder(path: string): Promise<void>;
}

declare module "../../wailsjs/go/main/App" {
  export type SpotifySearchRequest = {
    query: string;
    limit: number;
    market?: string;
  };

  export type SpotifySearchByTypeRequest = {
    query: string;
    search_type: "track" | "album" | "artist" | "playlist" | string;
    limit: number;
    offset: number;
    market?: string;
  };

  export function GetDefaults(): Promise<any>;
  export function GetStreamURL(req: any): Promise<string>;

  export function SearchSpotify(req: SpotifySearchRequest): Promise<import("../../wailsjs/go/models").backend.SearchResponse>;
  export function SearchSpotifyByType(
    req: SpotifySearchByTypeRequest
  ): Promise<import("../../wailsjs/go/models").backend.SearchResult[]>;

  export function GetSpotifyMetadata(url: string, delay?: number, batch?: string): Promise<any>;
  export function DownloadTrack(req: any): Promise<any>;
  export function DownloadLyrics(req: any): Promise<any>;
  export function DownloadCover(req: any): Promise<any>;

  export function GetDownloadQueue(): Promise<any>;
  export function ClearCompletedDownloads(): Promise<any>;
  export function GetDownloadProgress(): Promise<any>;

  export function CheckTrackAvailability(spotifyId: string): Promise<any>;

  export function SelectFolder(): Promise<string>;
  export function SelectFile(): Promise<string>;
  export function SelectAudioFiles(): Promise<string[]>;

  export function IsFFmpegInstalled(): Promise<boolean>;
  export function DownloadFFmpeg(): Promise<any>;
  export function ConvertAudio(req: any): Promise<any>;

  export function AnalyzeTrack(filePath: string): Promise<string>;

  export function ReadTextFile(path: string): Promise<string>;
}

declare module "../../wailsjs/go/models" {
  export namespace backend {
    export type SearchResult = {
      id: string;
      name: string;
      artists?: string;
      owner?: string;
      images?: string;
      external_urls: string;
      duration_ms?: number;
      total_tracks?: number;
    };

    export class SearchResponse {
      tracks: SearchResult[];
      albums: SearchResult[];
      artists: SearchResult[];
      playlists: SearchResult[];
      constructor(data?: Partial<SearchResponse>);
    }
  }

  export namespace main {
    export type DownloadItem = any;
    export type DownloadQueue = any;
  }
}

declare module "../../wailsjs/runtime/runtime" {
  export function BrowserOpenURL(url: string): void;
  export function WindowMinimise(): void;
  export function WindowToggleMaximise(): void;
  export function Quit(): void;

  export function OnFileDrop(
    cb: (x: number, y: number, paths: string[]) => void,
    useDropTarget?: boolean
  ): void;

  export function OnFileDropOff(): void;
}
