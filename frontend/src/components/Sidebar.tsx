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
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const navItems = [
    { page: "main" as PageType, icon: HomeIcon, label: "Home" },
    { page: "history" as PageType, icon: HistoryIcon, label: "Download History" },
    { page: "audio-analysis" as PageType, icon: ActivityIcon, label: "Audio Quality Analyzer" },
    { page: "audio-converter" as PageType, icon: FileMusicIcon, label: "Audio Converter" },
    { page: "file-manager" as PageType, icon: FilePenIcon, label: "File Manager" },
    { page: "debug" as PageType, icon: TerminalIcon, label: "Debug Logs" },
    { page: "settings" as PageType, icon: SettingsIcon, label: "Settings" },
  ];

  const bottomItems = [
    { page: "about" as PageType, icon: BadgeAlertIcon, label: "About" },
  ];

  return (
    <nav className="fixed left-0 top-0 h-full w-14 bg-card/80 backdrop-blur-xl border-r border-border/50 flex flex-col z-30">
      {/* Navigation items */}
      <div className="flex-1 flex flex-col items-center pt-14 gap-1">
        {navItems.map(({ page, icon: Icon, label }) => {
          const isActive = currentPage === page;
          return (
            <Tooltip key={page} delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-10 w-10 relative transition-all duration-200 ${
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => onPageChange(page)}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                  )}
                  <Icon size={20} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <p>{label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Bottom items */}
      <div className="flex flex-col items-center pb-4 gap-1">
        {bottomItems.map(({ page, icon: Icon, label }) => {
          const isActive = currentPage === page;
          return (
            <Tooltip key={page} delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-10 w-10 relative transition-all duration-200 ${
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => onPageChange(page)}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                  )}
                  <Icon size={20} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <p>{label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Ko-fi link */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
              onClick={() => openExternal("https://ko-fi.com/afkarxyz")}
            >
              <CoffeeIcon size={20} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <p>Support on Ko-fi</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}
