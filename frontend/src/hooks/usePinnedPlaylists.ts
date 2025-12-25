import { useCallback, useEffect, useState } from "react";
import {
  loadPinnedPlaylists,
  savePinnedPlaylists,
  togglePinnedPlaylist,
  type PinnedPlaylist,
} from "@/lib/pinned-playlists";

export function usePinnedPlaylists() {
  const [pinned, setPinned] = useState<PinnedPlaylist[]>([]);

  useEffect(() => {
    setPinned(loadPinnedPlaylists());
  }, []);

  const setPinnedAndPersist = useCallback((next: PinnedPlaylist[]) => {
    setPinned(next);
    savePinnedPlaylists(next);
  }, []);

  const togglePinned = useCallback(
    (playlist: { url: string; name: string; imageUrl?: string }) => {
      setPinnedAndPersist(togglePinnedPlaylist(loadPinnedPlaylists(), playlist));
    },
    [setPinnedAndPersist]
  );

  const removePinned = useCallback(
    (url: string) => {
      const items = loadPinnedPlaylists();
      const next = items.filter((p) => p.url !== url);
      setPinnedAndPersist(next);
    },
    [setPinnedAndPersist]
  );

  return { pinned, setPinned: setPinnedAndPersist, togglePinned, removePinned };
}
