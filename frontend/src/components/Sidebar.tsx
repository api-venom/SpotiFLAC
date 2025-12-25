import { FileMusic, FilePen } from "lucide-react";
import { HomeIcon } from "@/components/ui/home";
import { SettingsIcon } from "@/components/ui/settings";
import { ActivityIcon } from "@/components/ui/activity";
import { TerminalIcon } from "@/components/ui/terminal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export type PageType = "main" | "settings" | "debug" | "audio-analysis" | "audio-converter" | "file-manager";

interface SidebarProps {
  currentPage: PageType;
  onPageChange: (page: PageType) => void;
  children?: ReactNode;
}

export function Sidebar({ currentPage, onPageChange, children }: SidebarProps) {
  return (
    <div className="fixed left-0 top-0 h-full w-80 bg-card/70 supports-[backdrop-filter]:bg-card/50 backdrop-blur-xl border-r border-border/60 flex z-30">
      {/* Icon rail */}
      <div className="h-full w-14 border-r border-border/60 flex flex-col items-center py-14">
        <div className="flex flex-col gap-2 flex-1">
          {/* Home */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "main" ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10"
                onClick={() => onPageChange("main")}
              >
                <HomeIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Home</p>
            </TooltipContent>
          </Tooltip>

          {/* Settings */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "settings" ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10"
                onClick={() => onPageChange("settings")}
              >
                <SettingsIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>

          {/* Audio Analysis */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "audio-analysis" ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10"
                onClick={() => onPageChange("audio-analysis")}
              >
                <ActivityIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Audio Quality Analyzer</p>
            </TooltipContent>
          </Tooltip>

          {/* Audio Converter */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "audio-converter" ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10"
                onClick={() => onPageChange("audio-converter")}
              >
                <FileMusic className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Audio Converter</p>
            </TooltipContent>
          </Tooltip>

          {/* File Manager */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "file-manager" ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10"
                onClick={() => onPageChange("file-manager")}
              >
                <FilePen className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>File Manager</p>
            </TooltipContent>
          </Tooltip>

          {/* Debug */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "debug" ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10"
                onClick={() => onPageChange("debug")}
              >
                <TerminalIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Debug Logs</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Sidebar content */}
      <div className="flex-1 h-full pt-14 pb-4 px-4 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
