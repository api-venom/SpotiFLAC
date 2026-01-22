import type { ReactNode } from "react";
import { HomeIcon } from "@/components/ui/home";
import { HistoryIcon } from "@/components/ui/history-icon";
import { SettingsIcon } from "@/components/ui/settings";
import { ActivityIcon } from "@/components/ui/activity";
import { TerminalIcon } from "@/components/ui/terminal";
import { FileMusicIcon } from "@/components/ui/file-music";
import { FilePenIcon } from "@/components/ui/file-pen";
import { CoffeeIcon } from "@/components/ui/coffee";
import { BadgeAlertIcon } from "@/components/ui/badge-alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";

export type PageType =
  | "main"
  | "settings"
  | "debug"
  | "audio-analysis"
  | "audio-converter"
  | "file-manager"
  | "about"
  | "history";

interface SidebarProps {
  currentPage: PageType;
  onPageChange: (page: PageType) => void;
  children?: ReactNode;
}

const navButtonClass = (active: boolean) =>
  `h-10 w-10 ${
    active
      ? "bg-primary/10 text-primary hover:bg-primary/20"
      : "hover:bg-primary/10 hover:text-primary"
  }`;

export function Sidebar({ currentPage, onPageChange, children }: SidebarProps) {
  return (
    <div className="fixed left-0 top-0 h-full w-80 bg-card/70 supports-[backdrop-filter]:bg-card/50 backdrop-blur-xl border-r border-border/60 flex z-30">
      <div className="h-full w-14 border-r border-border/60 flex flex-col items-center py-14">
        <div className="flex flex-col gap-2 flex-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "main" ? "secondary" : "ghost"}
                size="icon"
                className={navButtonClass(currentPage === "main")}
                onClick={() => onPageChange("main")}
              >
                <HomeIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Home</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "history" ? "secondary" : "ghost"}
                size="icon"
                className={navButtonClass(currentPage === "history")}
                onClick={() => onPageChange("history")}
              >
                <HistoryIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Download History</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "audio-analysis" ? "secondary" : "ghost"}
                size="icon"
                className={navButtonClass(currentPage === "audio-analysis")}
                onClick={() => onPageChange("audio-analysis")}
              >
                <ActivityIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Audio Quality Analyzer</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "audio-converter" ? "secondary" : "ghost"}
                size="icon"
                className={navButtonClass(currentPage === "audio-converter")}
                onClick={() => onPageChange("audio-converter")}
              >
                <FileMusicIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Audio Converter</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "file-manager" ? "secondary" : "ghost"}
                size="icon"
                className={navButtonClass(currentPage === "file-manager")}
                onClick={() => onPageChange("file-manager")}
              >
                <FilePenIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>File Manager</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "debug" ? "secondary" : "ghost"}
                size="icon"
                className={navButtonClass(currentPage === "debug")}
                onClick={() => onPageChange("debug")}
              >
                <TerminalIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Debug Logs</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "settings" ? "secondary" : "ghost"}
                size="icon"
                className={navButtonClass(currentPage === "settings")}
                onClick={() => onPageChange("settings")}
              >
                <SettingsIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-auto flex flex-col gap-2">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={currentPage === "about" ? "secondary" : "ghost"}
                size="icon"
                className={navButtonClass(currentPage === "about")}
                onClick={() => onPageChange("about")}
              >
                <BadgeAlertIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>About</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={navButtonClass(false)}
                onClick={() => openExternal("https://ko-fi.com/afkarxyz")}
              >
                <CoffeeIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Every coffee helps me keep going</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 h-full pt-14 pb-4 px-4 overflow-y-auto">{children}</div>
    </div>
  );
}
