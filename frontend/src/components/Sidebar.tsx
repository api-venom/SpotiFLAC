import { useMemo } from "react";
import {
  Home,
  Sparkles,
  Radio,
  Library,
  Pin,
  Clock,
  Mic2,
  Album,
  Music,
  ListMusic,
  Activity,
  Settings,
  Wrench,
  AudioWaveform,
  FileAudio,
  FolderKanban,
  Search,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PageType = "main" | "settings" | "debug" | "audio-analysis" | "audio-converter" | "file-manager";

interface SidebarProps {
  currentPage: PageType;
  onPageChange: (page: PageType) => void;
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const items = useMemo(
    () => [
      {
        section: "main",
        items: [
          { label: "Home", icon: Home, page: "main" as const },
          { label: "New", icon: Sparkles, page: "main" as const },
          { label: "Radio", icon: Radio, page: "main" as const },
        ],
      },
      {
        section: "library",
        items: [
          { label: "Pins", icon: Pin, page: "main" as const },
          { label: "Recently Added", icon: Clock, page: "main" as const },
          { label: "Artists", icon: Mic2, page: "main" as const },
          { label: "Albums", icon: Album, page: "main" as const },
          { label: "Songs", icon: Music, page: "main" as const },
        ],
      },
      {
        section: "playlists",
        items: [
          { label: "All Playlists", icon: ListMusic, page: "main" as const },
          { label: "Favourite Songs", icon: Music, page: "main" as const },
        ],
      },
      {
        section: "tools",
        items: [
          { label: "Activity", icon: Activity, page: "debug" as const },
          { label: "Audio Analyzer", icon: AudioWaveform, page: "audio-analysis" as const },
          { label: "Audio Converter", icon: FileAudio, page: "audio-converter" as const },
          { label: "File Manager", icon: FolderKanban, page: "file-manager" as const },
          { label: "Settings", icon: Settings, page: "settings" as const },
        ],
      },
    ],
    []
  );

  const isActive = (page: PageType) => currentPage === page;

  return (
    <aside className="fixed left-0 top-0 h-full w-72 bg-card border-r border-border z-30 pt-10">
      <div className="h-full flex flex-col px-3 py-4">
        {/* Search */}
        <div className="relative mb-4">
          <Input
            placeholder="Search"
            className="pr-9"
            aria-label="Search"
          />
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>

        {/* Main */}
        <nav className="flex-1 overflow-y-auto">
          {/* Top group */}
          <div className="space-y-1">
            {items
              .find((s) => s.section === "main")
              ?.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.label}
                    variant={isActive(item.page) ? "secondary" : "ghost"}
                    className="w-full justify-start gap-2"
                    onClick={() => onPageChange(item.page)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{item.label}</span>
                  </Button>
                );
              })}
          </div>

          {/* Library header */}
          <div className="mt-5 mb-2 flex items-center justify-between px-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Library className="h-4 w-4" />
              <span>Library</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange("settings")}
              aria-label="Library options"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>

          <div className="space-y-1">
            {items
              .find((s) => s.section === "library")
              ?.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.label}
                    variant={item.page === "main" && currentPage === "main" ? "ghost" : "ghost"}
                    className="w-full justify-start gap-2"
                    onClick={() => onPageChange(item.page)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{item.label}</span>
                  </Button>
                );
              })}
          </div>

          {/* Playlists */}
          <div className="mt-5 mb-2 flex items-center justify-between px-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ListMusic className="h-4 w-4" />
              <span>Playlists</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange("main")}
              aria-label="Add playlist"
            >
              <Wrench className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          <div className="space-y-1">
            {items
              .find((s) => s.section === "playlists")
              ?.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.label}
                    variant="ghost"
                    className="w-full justify-start gap-2"
                    onClick={() => onPageChange(item.page)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{item.label}</span>
                  </Button>
                );
              })}
          </div>

          {/* Tools */}
          <div className="mt-6 mb-2 px-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Wrench className="h-4 w-4" />
            <span>Tools</span>
          </div>
          <div className="space-y-1">
            {items
              .find((s) => s.section === "tools")
              ?.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.label}
                    variant={isActive(item.page) ? "secondary" : "ghost"}
                    className="w-full justify-start gap-2"
                    onClick={() => onPageChange(item.page)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{item.label}</span>
                  </Button>
                );
              })}
          </div>
        </nav>

        {/* Footer (kept minimal; no GitHub/Coffee/Projects buttons) */}
        <div className="mt-4 text-xs text-muted-foreground px-2">
          <span className="truncate block">SpotiFLAC</span>
        </div>
    </div>
    </aside>
}
