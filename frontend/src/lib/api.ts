import type {
    SpotifyMetadataResponse,
    DownloadRequest,
    DownloadResponse,
    HealthResponse,
    LyricsDownloadRequest,
    LyricsDownloadResponse,
    CoverDownloadRequest,
    CoverDownloadResponse,
    HeaderDownloadRequest,
    HeaderDownloadResponse,
    GalleryImageDownloadRequest,
    GalleryImageDownloadResponse,
    AvatarDownloadRequest,
    AvatarDownloadResponse,
    AnalysisResult,
} from "@/types/api";
import type { WordLyricsResponse } from "@/lib/lyrics/wordLyrics";
import { GetSpotifyMetadata, DownloadTrack, DownloadLyrics, DownloadCover, DownloadHeader, DownloadGalleryImage, DownloadAvatar, AnalyzeTrack, FetchWordLyricsLive } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";

export async function fetchSpotifyMetadata(url: string, batch: boolean = true, delay: number = 1.0, timeout: number = 300.0): Promise<SpotifyMetadataResponse> {
    const req = new main.SpotifyMetadataRequest({ url, batch, delay, timeout });
    const jsonString = await GetSpotifyMetadata(req);
    return JSON.parse(jsonString);
}

export async function analyzeTrack(filePath: string): Promise<AnalysisResult> {
    const jsonString = await AnalyzeTrack(filePath);
    return JSON.parse(jsonString) as AnalysisResult;
}
export async function downloadTrack(request: DownloadRequest): Promise<DownloadResponse> {
    const req = new main.DownloadRequest(request);
    return await DownloadTrack(req);
}
export async function checkHealth(): Promise<HealthResponse> {
    return {
        status: "ok",
        time: new Date().toISOString(),
    };
}
export async function downloadLyrics(request: LyricsDownloadRequest): Promise<LyricsDownloadResponse> {
    const req = new main.LyricsDownloadRequest(request);
    return await DownloadLyrics(req);
}
export async function downloadCover(request: CoverDownloadRequest): Promise<CoverDownloadResponse> {
    const req = new main.CoverDownloadRequest(request);
    return await DownloadCover(req);
}
export async function downloadHeader(request: HeaderDownloadRequest): Promise<HeaderDownloadResponse> {
    const req = new main.HeaderDownloadRequest(request);
    return await DownloadHeader(req);
}
export async function downloadGalleryImage(request: GalleryImageDownloadRequest): Promise<GalleryImageDownloadResponse> {
    const req = new main.GalleryImageDownloadRequest(request);
    return await DownloadGalleryImage(req);
}
export async function downloadAvatar(request: AvatarDownloadRequest): Promise<AvatarDownloadResponse> {
    const req = new main.AvatarDownloadRequest(request);
    return await DownloadAvatar(req);
}

// Fetch word-level lyrics for karaoke-style sync
export async function fetchWordLyrics(
    trackName: string,
    artistName: string,
    albumName: string,
    durationSec: number
): Promise<WordLyricsResponse> {
    return await FetchWordLyricsLive(trackName, artistName, albumName, durationSec);
}
