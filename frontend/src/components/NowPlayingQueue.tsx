import { X, ListMusic, Shuffle, Repeat, Repeat1, Play, Pause, Trash2, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePlayer } from "@/hooks/usePlayer";
import { cn } from "@/lib/utils";

interface NowPlayingQueueProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NowPlayingQueue({ isOpen, onClose }: NowPlayingQueueProps) {
  const { state, player } = usePlayer();

  const handleTrackClick = (index: number) => {
    player.jumpToQueueIndex(index);
  };

  const handleClearQueue = () => {
    player.clearQueue();
  };

  const getRepeatIcon = () => {
    switch (state.repeat) {
      case "one":
        return <Repeat1 className="h-4 w-4" />;
      default:
        return <Repeat className="h-4 w-4" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md w-[95vw] max-h-[80vh] flex flex-col p-0 gap-0 [&>button]:hidden">
        <DialogHeader className="px-5 pt-5 pb-4 border-b space-y-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <ListMusic className="h-5 w-5" />
              Now Playing
            </DialogTitle>
            <div className="flex items-center gap-1">
              {state.queue.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={handleClearQueue}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-2 pt-3">
            <Button
              variant={state.shuffle ? "secondary" : "ghost"}
              size="icon"
              className={cn("h-8 w-8", state.shuffle && "text-primary")}
              onClick={() => player.toggleShuffle()}
            >
              <Shuffle className="h-4 w-4" />
            </Button>
            <Button
              variant={state.repeat !== "off" ? "secondary" : "ghost"}
              size="icon"
              className={cn("h-8 w-8", state.repeat !== "off" && "text-primary")}
              onClick={() => player.cycleRepeat()}
            >
              {getRepeatIcon()}
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {state.queue.length} track{state.queue.length !== 1 ? "s" : ""}
            </span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {state.queue.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Music className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Queue is empty</p>
              <p className="text-xs mt-1">Play some music to see it here</p>
            </div>
          ) : (
            <div className="py-2">
              {state.queue.map((track, index) => {
                const isCurrentTrack = index === state.queueIndex;
                return (
                  <button
                    key={`${track.spotifyId}-${index}`}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left",
                      isCurrentTrack && "bg-primary/10"
                    )}
                    onClick={() => handleTrackClick(index)}
                  >
                    {/* Track number or playing indicator */}
                    <div className="w-6 flex-shrink-0 text-center">
                      {isCurrentTrack && state.isPlaying ? (
                        <div className="flex items-center justify-center gap-0.5">
                          <span className="w-0.5 h-3 bg-primary rounded-full animate-[bounce_0.6s_ease-in-out_infinite]" />
                          <span className="w-0.5 h-4 bg-primary rounded-full animate-[bounce_0.6s_ease-in-out_infinite_0.1s]" />
                          <span className="w-0.5 h-2 bg-primary rounded-full animate-[bounce_0.6s_ease-in-out_infinite_0.2s]" />
                        </div>
                      ) : isCurrentTrack ? (
                        <Pause className="h-4 w-4 text-primary mx-auto" />
                      ) : (
                        <span className="text-xs text-muted-foreground">{index + 1}</span>
                      )}
                    </div>

                    {/* Album art */}
                    {track.coverUrl ? (
                      <img
                        src={track.coverUrl}
                        alt={track.title}
                        className="w-10 h-10 rounded object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                        <Music className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}

                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium truncate",
                          isCurrentTrack && "text-primary"
                        )}
                      >
                        {track.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {track.artist}
                      </p>
                    </div>

                    {/* Play indicator for non-current tracks */}
                    {!isCurrentTrack && (
                      <Play className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Now playing footer */}
        {state.current && (
          <div className="border-t px-4 py-3 bg-muted/30">
            <div className="flex items-center gap-3">
              {state.current.coverUrl && (
                <img
                  src={state.current.coverUrl}
                  alt={state.current.title}
                  className="w-10 h-10 rounded shadow"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{state.current.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {state.current.artist}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => player.togglePlay()}
              >
                {state.isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
