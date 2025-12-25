import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import QRCode from "qrcode";
import {
  buildPinnedPlaylistsSharePayload,
  parsePinnedPlaylistsSharePayload,
  type PinnedPlaylist,
} from "@/lib/pinned-playlists";
import { usePinnedPlaylists } from "@/hooks/usePinnedPlaylists";

interface PinnedPlaylistsProps {
  onOpenUrl: (url: string) => void;
}

export function PinnedPlaylists({ onOpenUrl }: PinnedPlaylistsProps) {
  const { pinned, setPinned, removePinned } = usePinnedPlaylists();

  const [shareOpen, setShareOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const sharePayload = useMemo(() => buildPinnedPlaylistsSharePayload(pinned), [pinned]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Pinned</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShareOpen(true)} disabled={pinned.length === 0}>
            Share
          </Button>
        </div>
      </div>

      {pinned.length === 0 ? (
        <div className="text-sm text-muted-foreground bg-card border rounded-lg p-3">
          No pinned playlists yet.
        </div>
      ) : (
        <div className="grid gap-2">
          {pinned.map((p: PinnedPlaylist) => (
            <div
              key={p.url}
              className="flex items-center gap-3 p-3 rounded-lg bg-card border"
            >
              <div className="h-10 w-10 rounded-md overflow-hidden bg-muted shrink-0">
                {p.imageUrl ? (
                  <img src={p.imageUrl} className="h-full w-full object-cover" alt={p.name} />
                ) : null}
              </div>

              <button
                type="button"
                className={cn("flex-1 min-w-0 text-left", "hover:underline")}
                onClick={() => onOpenUrl(p.url)}
                title={p.url}
              >
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground truncate">{p.url}</div>
              </button>

              <Button variant="ghost" size="sm" onClick={() => removePinned(p.url)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Share pinned playlists</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Copy this payload (or encode it as a QR) to import on another machine.
            </p>

            <div className="flex items-start gap-4">
              <div className="shrink-0">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Pinned playlists QR"
                    className="h-40 w-40 rounded-md bg-white p-2"
                  />
                ) : (
                  <div className="h-40 w-40 rounded-md bg-muted flex items-center justify-center text-sm text-muted-foreground">
                    QR not generated
                  </div>
                )}
              </div>

              <textarea
                className="w-full h-40 rounded-md border bg-background p-3 text-sm font-mono"
                value={sharePayload}
                readOnly
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const url = await QRCode.toDataURL(sharePayload, {
                    errorCorrectionLevel: "M",
                    margin: 1,
                    width: 240,
                  });
                  setQrDataUrl(url);
                } catch {
                  setQrDataUrl(null);
                }
              }}
            >
              Generate QR
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sharePayload);
                } catch {
                  // ignore
                }
              }}
            >
              Copy
            </Button>
            <Button variant="outline" onClick={() => setShareOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Import pinned playlists</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Paste the shared payload or a single Spotify URL.
            </p>
            <Input
              placeholder='Paste payload or "https://open.spotify.com/playlist/..."'
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                const imported = parsePinnedPlaylistsSharePayload(importText);
                if (!imported) return;

                // Merge by URL.
                const existing = new Map(pinned.map((p) => [p.url, p]));
                for (const item of imported) {
                  existing.set(item.url, item);
                }
                setPinned(Array.from(existing.values()).sort((a, b) => b.pinnedAt - a.pinnedAt));
                setImportText("");
                setImportOpen(false);
              }}
            >
              Import
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
