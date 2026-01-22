import { useState, useEffect, useCallback, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Search, X, ArrowUp } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  getSettings,
  getSettingsWithDefaults,
  loadSettings,
  saveSettings,
  applyThemeMode,
  applyFont,
} from "@/lib/settings";
import { applyTheme } from "@/lib/themes";
import { OpenFolder, CheckFFmpegInstalled, DownloadFFmpeg } from "../wailsjs/go/main/App";
import { EventsOn, EventsOff, Quit } from "../wailsjs/runtime/runtime";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar, type PageType } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { SearchBar } from "@/components/SearchBar";
import { TrackInfo } from "@/components/TrackInfo";
import { AlbumInfo } from "@/components/AlbumInfo";
import { PlaylistInfo } from "@/components/PlaylistInfo";
import { ArtistInfo } from "@/components/ArtistInfo";
import { DownloadQueue } from "@/components/DownloadQueue";
import { DownloadProgressToast } from "@/components/DownloadProgressToast";
import { AudioAnalysisPage } from "@/components/AudioAnalysisPage";
import { AudioConverterPage } from "@/components/AudioConverterPage";
import { FileManagerPage } from "@/components/FileManagerPage";
import { SettingsPage } from "@/components/SettingsPage";
import { DebugLoggerPage } from "@/components/DebugLoggerPage";
import { AmbientBackground } from "@/components/AmbientBackground";
import { LyricsOverlay, type LyricsOverlayTrack } from "@/components/LyricsOverlay";
import { FullScreenPlayer } from "@/components/FullScreenPlayer";
import { MiniPlayer } from "@/components/MiniPlayer";
import { AboutPage } from "@/components/AboutPage";
import { HistoryPage } from "@/components/HistoryPage";
import type { HistoryItem } from "@/components/FetchHistory";
import { useDownload } from "@/hooks/useDownload";
import { useMetadata } from "@/hooks/useMetadata";
import { useLyrics } from "@/hooks/useLyrics";
import { useCover } from "@/hooks/useCover";
import { useAvailability } from "@/hooks/useAvailability";
import { useDownloadQueueDialog } from "@/hooks/useDownloadQueueDialog";
import { usePlayer } from "@/hooks/usePlayer";
import { useDownloadProgress } from "@/hooks/useDownloadProgress";

const HISTORY_KEY = "spotiflac_fetch_history";
const MAX_HISTORY = 5;

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>("main");
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("default");
  const [currentListPage, setCurrentListPage] = useState(1);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [releaseDate, setReleaseDate] = useState<string | null>(null);
  const [fetchHistory, setFetchHistory] = useState<HistoryItem[]>([]);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [hasUnsavedSettings, setHasUnsavedSettings] = useState(false);
  const [pendingPageChange, setPendingPageChange] = useState<PageType | null>(null);
  const [showUnsavedChangesDialog, setShowUnsavedChangesDialog] = useState(false);
  const [resetSettingsFn, setResetSettingsFn] = useState<(() => void) | null>(null);
  const [lyricsOverlayOpen, setLyricsOverlayOpen] = useState(false);
  const [lyricsOverlayTrack, setLyricsOverlayTrack] = useState<LyricsOverlayTrack | null>(null);

  const ITEMS_PER_PAGE = 50;
  const CURRENT_VERSION = "7.0.6";

  const download = useDownload();
  const metadata = useMetadata();
  const lyrics = useLyrics();
  const cover = useCover();
  const availability = useAvailability();
  const downloadQueue = useDownloadQueueDialog();
  const downloadProgress = useDownloadProgress();
  const { state: playerState } = usePlayer();

  const [isFFmpegInstalled, setIsFFmpegInstalled] = useState<boolean | null>(null);
  const [isInstallingFFmpeg, setIsInstallingFFmpeg] = useState(false);
  const [ffmpegInstallProgress, setFfmpegInstallProgress] = useState(0);
  const [ffmpegInstallStatus, setFfmpegInstallStatus] = useState("");

  const openLyricsOverlay = (name: string, artists: string, spotifyId?: string, coverUrl?: string) => {
    if (!spotifyId) return;
    setLyricsOverlayTrack({ spotify_id: spotifyId, name, artists, coverUrl });
    setLyricsOverlayOpen(true);
  };

  const checkForUpdates = async () => {
    try {
      const response = await fetch("https://api.github.com/repos/afkarxyz/SpotiFLAC/releases/latest");
      const data = await response.json();
      const latestVersion = data.tag_name?.replace(/^v/, "") || "";

      if (data.published_at) {
        setReleaseDate(data.published_at);
      }

      if (latestVersion && latestVersion > CURRENT_VERSION) {
        setHasUpdate(true);
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
    }
  };

  const loadHistory = () => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        setFetchHistory(JSON.parse(saved));
      }
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  };

  const saveHistory = (history: HistoryItem[]) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (err) {
      console.error("Failed to save history:", err);
    }
  };

  const addToHistory = (item: Omit<HistoryItem, "id" | "timestamp">) => {
    setFetchHistory((prev) => {
      const filtered = prev.filter((h) => h.url !== item.url);
      const newItem: HistoryItem = {
        ...item,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      const updated = [newItem, ...filtered].slice(0, MAX_HISTORY);
      saveHistory(updated);
      return updated;
    });
  };

  const removeFromHistory = (id: string) => {
    setFetchHistory((prev) => {
      const updated = prev.filter((h) => h.id !== id);
      saveHistory(updated);
      return updated;
    });
  };

  const handleHistorySelect = async (item: HistoryItem) => {
    setSpotifyUrl(item.url);
    const updatedUrl = await metadata.handleFetchMetadata(item.url);
    if (updatedUrl) {
      setSpotifyUrl(updatedUrl);
    }
  };

  const handleFetchMetadata = async () => {
    const updatedUrl = await metadata.handleFetchMetadata(spotifyUrl);
    if (updatedUrl) {
      setSpotifyUrl(updatedUrl);
    }
  };

  useLayoutEffect(() => {
    const savedSettings = getSettings();
    if (savedSettings) {
      applyThemeMode(savedSettings.themeMode);
      applyTheme(savedSettings.theme);
      applyFont(savedSettings.fontFamily);
    }
  }, []);

  useEffect(() => {
    const initSettings = async () => {
      const settings = await loadSettings();
      applyThemeMode(settings.themeMode);
      applyTheme(settings.theme);
      applyFont(settings.fontFamily);

      if (!settings.downloadPath) {
        const settingsWithDefaults = await getSettingsWithDefaults();
        await saveSettings(settingsWithDefaults);
      }
    };

    initSettings();

    const checkFFmpeg = async () => {
      try {
        const installed = await CheckFFmpegInstalled();
        setIsFFmpegInstalled(installed);
      } catch (err) {
        console.error("Failed to check FFmpeg:", err);
        setIsFFmpegInstalled(false);
      }
    };

    checkFFmpeg();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentSettings = getSettings();
      if (currentSettings.themeMode === "auto") {
        applyThemeMode("auto");
        applyTheme(currentSettings.theme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    checkForUpdates();
    loadHistory();

    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", handleScroll);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    setSelectedTracks([]);
    setSearchQuery("");
    download.resetDownloadedTracks();
    lyrics.resetLyricsState();
    cover.resetCoverState();
    availability.clearAvailability();
    setSortBy("default");
    setCurrentListPage(1);
  }, [metadata.metadata]);

  useEffect(() => {
    if (!metadata.metadata || !spotifyUrl) return;

    let historyItem: Omit<HistoryItem, "id" | "timestamp"> | null = null;

    if ("track" in metadata.metadata) {
      const { track } = metadata.metadata;
      historyItem = {
