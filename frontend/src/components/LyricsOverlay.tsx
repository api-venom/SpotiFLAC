import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReadTextFile } from "../../wailsjs/go/main/App";

export interface LyricsOverlayTrack {
  spotify_id: string;
  name: string;
  artists: string;
}

type ParsedLine = { t: number | null; text: string };

function parseLRC(content: string): ParsedLine[] {
  const lines = content.split(/\r?\n/);
  const out: ParsedLine[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;

    const m = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
    if (!m) {
      out.push({ t: null, text: line });
      continue;
    }

    const min = Number(m[1]);
    const sec = Number(m[2]);
    const frac = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
    const t = min * 60 + sec + frac / 1000;
    const text = (m[4] || "").trim();
    if (text) out.push({ t, text });
  }

  return out.length ? out : [{ t: null, text: content.trim() }];
}

interface LyricsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track: LyricsOverlayTrack | null;
  ensureLyricsFile: (spotifyId: string) => Promise<string | null>;
}

export function LyricsOverlay({
  open,
  onOpenChange,
  track,
  ensureLyricsFile,
}: LyricsOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");

  const parsed = useMemo(() => parseLRC(content), [content]);

  useEffect(() => {
    if (!open || !track?.spotify_id) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setContent("");
      try {
        const filePath = await ensureLyricsFile(track.spotify_id);
        if (!filePath) {
          throw new Error("Lyrics file not available");
        }
        const text = await ReadTextFile(filePath);
        if (!cancelled) setContent(text || "");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load lyrics";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, track?.spotify_id, ensureLyricsFile]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-none w-screen h-[100dvh] rounded-none border-0 bg-background/40 supports-[backdrop-filter]:bg-background/30 backdrop-blur-xl">
        <DialogHeader className="px-6 pt-6 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate">{track ? track.name : "Lyrics"}</DialogTitle>
              {track ? (
                <p className="text-sm text-muted-foreground truncate">{track.artists}</p>
              ) : null}
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogHeader>

        <div className="px-6 pb-8 overflow-auto">
          {loading ? (
            <div className="py-16 text-center text-muted-foreground">Loading lyrics…</div>
          ) : error ? (
            <div className="py-16 text-center text-destructive">{error}</div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {parsed.map((l, idx) => (
                <div
                  key={`${idx}-${l.t ?? "x"}`}
                  className={cn(
                    "py-2 text-2xl md:text-3xl font-semibold tracking-tight",
                    idx === 0 ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
