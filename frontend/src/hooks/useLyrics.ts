import { useRef, useState, useCallback } from "react";
import { downloadLyrics, fetchWordLyrics } from "@/lib/api";
import { getSettings, parseTemplate, type TemplateData } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";
import type { WordTimeline } from "@/lib/lyrics/wordLyrics";
import { buildWordTimeline } from "@/lib/lyrics/wordLyrics";

export function useLyrics() {
  const [downloadingLyricsTrack, setDownloadingLyricsTrack] = useState<string | null>(null);
  const [downloadedLyrics, setDownloadedLyrics] = useState<Set<string>>(new Set());
  const [failedLyrics, setFailedLyrics] = useState<Set<string>>(new Set());
  const [skippedLyrics, setSkippedLyrics] = useState<Set<string>>(new Set());
  const [isBulkDownloadingLyrics, setIsBulkDownloadingLyrics] = useState(false);
  const [lyricsDownloadProgress, setLyricsDownloadProgress] = useState(0);
  const [lyricsFiles, setLyricsFiles] = useState<Record<string, string>>({});

  const stopBulkDownloadRef = useRef(false);

  const buildOutputDir = (
    os: string,
    baseDownloadPath: string,
    folderTemplate: string,
    templateData: TemplateData,
    playlistName?: string,
    options?: { isAlbum?: boolean }
  ) => {
    const placeholder = "__SLASH_PLACEHOLDER__";

    let outputDir = baseDownloadPath;

    // Keep legacy behavior in a safer way:
    // - If playlistName exists, usually prepend it as a folder.
    // - If we're in an album context and the folder template already contains an album/album-artist/playlist token,
    //   don't double-nest.
    const useAlbumSubfolder =
      folderTemplate.includes("{album}") ||
      folderTemplate.includes("{album_artist}") ||
      folderTemplate.includes("{playlist}");

    if (playlistName && (!options?.isAlbum || !useAlbumSubfolder)) {
      outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
    }

    if (!folderTemplate) return outputDir;

    const folderPath = parseTemplate(folderTemplate, {
      ...templateData,
      // Ensure values won't be interpreted as path separators.
      artist: templateData.artist?.replace(/\//g, placeholder),
      album: templateData.album?.replace(/\//g, placeholder),
      album_artist: templateData.album_artist?.replace(/\//g, placeholder),
      title: templateData.title?.replace(/\//g, placeholder),
      playlist: templateData.playlist?.replace(/\//g, placeholder),
    });

    if (!folderPath) return outputDir;

    const parts = folderPath.split("/").filter((p) => p.trim());
    for (const part of parts) {
      // Restore any slashes that were in original values as spaces
      const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
      outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
    }

    return outputDir;
  };

  const handleDownloadLyrics = useCallback(async (
    spotifyId: string,
    trackName: string,
    artistName: string,
    albumName?: string,
    playlistName?: string,
    position?: number,
    albumArtist?: string,
    releaseDate?: string,
    discNumber?: number,
    isAlbum?: boolean
  ): Promise<string | null> => {
    if (!spotifyId) {
      toast.error("No Spotify ID found for this track");
      return null;
    }

    logger.info(`downloading lyrics: ${trackName} - ${artistName}`);

    const settings = getSettings();
    setDownloadingLyricsTrack(spotifyId);

    try {
      const os = settings.operatingSystem;
      const folderTemplate = settings.folderTemplate || "";
      const useAlbumTrackNumber = folderTemplate.includes("{album}");

      const outputDir = buildOutputDir(
        os,
        settings.downloadPath,
        folderTemplate,
        {
          artist: artistName,
          album: albumName,
          title: trackName,
          track: position,
          playlist: playlistName,
          album_artist: albumArtist,
        },
        playlistName,
        { isAlbum }
      );

      const response = await downloadLyrics({
        spotify_id: spotifyId,
        track_name: trackName,
        artist_name: artistName,
        album_name: albumName,
        album_artist: albumArtist,
        release_date: releaseDate,
        output_dir: outputDir,
        filename_format: settings.filenameTemplate || "{title}",
        track_number: settings.trackNumber,
        position: position || 0,
        use_album_track_number: useAlbumTrackNumber,
        disc_number: discNumber,
      });

      if (response.success) {
        if (response.file) {
          setLyricsFiles((prev) => ({ ...prev, [spotifyId]: response.file! }));
        }

        if (response.already_exists) {
          toast.info("Lyrics file already exists");
          setSkippedLyrics((prev) => new Set(prev).add(spotifyId));
        } else {
          toast.success("Lyrics downloaded successfully");
          setDownloadedLyrics((prev) => new Set(prev).add(spotifyId));
        }

        setFailedLyrics((prev) => {
          const next = new Set(prev);
          next.delete(spotifyId);
          return next;
        });

        return response.file || null;
      }

      toast.error(response.error || "Failed to download lyrics");
      setFailedLyrics((prev) => new Set(prev).add(spotifyId));
      return null;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download lyrics");
      setFailedLyrics((prev) => new Set(prev).add(spotifyId));
      return null;
    } finally {
      setDownloadingLyricsTrack(null);
    }
  }, []);

  const ensureLyricsFile = useCallback(async (spotifyId: string): Promise<string | null> => {
    if (!spotifyId) return null;
    return lyricsFiles[spotifyId] || null;
  }, [lyricsFiles]);

  const handleDownloadAllLyrics = async (
    tracks: TrackMetadata[],
    playlistName?: string,
    _isArtistDiscography?: boolean,
    isAlbum?: boolean
  ) => {
    const tracksWithSpotifyId = tracks.filter((t) => t.spotify_id);

    if (tracksWithSpotifyId.length === 0) {
      toast.error("No tracks with Spotify ID available for lyrics download");
      return;
    }

    const settings = getSettings();
    setIsBulkDownloadingLyrics(true);
    setLyricsDownloadProgress(0);
    stopBulkDownloadRef.current = false;

    let completed = 0;
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const total = tracksWithSpotifyId.length;

    const os = settings.operatingSystem;
    const folderTemplate = settings.folderTemplate || "";
    const useAlbumTrackNumber = folderTemplate.includes("{album}");

    for (let i = 0; i < tracksWithSpotifyId.length; i++) {
      const track = tracksWithSpotifyId[i];

      if (stopBulkDownloadRef.current) {
        toast.info("Lyrics download stopped by user");
        break;
      }

      const id = track.spotify_id!;
      setDownloadingLyricsTrack(id);
      setLyricsDownloadProgress(Math.round((completed / total) * 100));

      try {
        // Align with downloads: use track.track_number when album context is expected.
        const trackPosition = useAlbumTrackNumber
          ? track.track_number || i + 1
          : i + 1;

        const outputDir = buildOutputDir(
          os,
          settings.downloadPath,
          folderTemplate,
          {
            artist: track.artists,
            album: track.album_name,
            title: track.name,
            track: trackPosition,
            playlist: playlistName,
            album_artist: track.album_artist,
          },
          playlistName,
          { isAlbum }
        );

        const response = await downloadLyrics({
          spotify_id: id,
          track_name: track.name,
          artist_name: track.artists,
          album_name: track.album_name,
          album_artist: track.album_artist,
          release_date: track.release_date,
          output_dir: outputDir,
          filename_format: settings.filenameTemplate || "{title}",
          track_number: settings.trackNumber,
          position: trackPosition,
          use_album_track_number: useAlbumTrackNumber,
          disc_number: track.disc_number,
        });

        if (response.success) {
          if (response.file) {
            setLyricsFiles((prev) => ({ ...prev, [id]: response.file! }));
          }

          if (response.already_exists) {
            skipped++;
            setSkippedLyrics((prev) => new Set(prev).add(id));
          } else {
            success++;
            setDownloadedLyrics((prev) => new Set(prev).add(id));
          }

          setFailedLyrics((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        } else {
          failed++;
          setFailedLyrics((prev) => new Set(prev).add(id));
        }
      } catch (err) {
        failed++;
        logger.error(`error downloading lyrics: ${track.name} - ${err}`);
        setFailedLyrics((prev) => new Set(prev).add(id));
      }

      completed++;
    }

    setDownloadingLyricsTrack(null);
    setIsBulkDownloadingLyrics(false);
    setLyricsDownloadProgress(0);

    if (!stopBulkDownloadRef.current) {
      toast.success(
        `Lyrics: ${success} downloaded, ${skipped} skipped, ${failed} failed`
      );
    }
  };

  const handleStopLyricsDownload = () => {
    logger.info("lyrics download stopped by user");
    stopBulkDownloadRef.current = true;
    toast.info("Stopping lyrics download...");
  };

  const resetLyricsState = useCallback(() => {
    setDownloadingLyricsTrack(null);
    setDownloadedLyrics(new Set());
    setFailedLyrics(new Set());
    setSkippedLyrics(new Set());
    setIsBulkDownloadingLyrics(false);
    setLyricsDownloadProgress(0);
    setLyricsFiles({});
  }, []);

  // Fetch word-level lyrics for karaoke-style sync
  // Returns a WordTimeline with syllable/word-level timing
  const handleFetchWordLyrics = useCallback(async (
    trackName: string,
    artistName: string,
    albumName: string,
    durationSec: number
  ): Promise<WordTimeline | null> => {
    try {
      logger.info(`fetching word lyrics: ${trackName} - ${artistName}`);
      const response = await fetchWordLyrics(trackName, artistName, albumName, durationSec);

      if (response.error) {
        logger.error(`word lyrics error: ${response.error}`);
        return null;
      }

      if (!response.lyrics || response.lyrics.length === 0) {
        logger.info(`no word lyrics found for: ${trackName}`);
        return null;
      }

      const timeline = buildWordTimeline(response);
      logger.info(`word lyrics loaded: ${timeline.lines.length} lines, type: ${timeline.type}, source: ${timeline.source}`);
      return timeline;
    } catch (err) {
      logger.error(`failed to fetch word lyrics: ${err}`);
      return null;
    }
  }, []);

  return {
    downloadingLyricsTrack,
    downloadedLyrics,
    failedLyrics,
    skippedLyrics,
    isBulkDownloadingLyrics,
    lyricsDownloadProgress,
    handleDownloadLyrics,
    handleDownloadAllLyrics,
    handleStopLyricsDownload,
    resetLyricsState,
    ensureLyricsFile,
    handleFetchWordLyrics,
  };
}
