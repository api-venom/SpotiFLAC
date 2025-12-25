import { KNIGHT_MUSIC_KEYS } from "@/lib/storage/keys";

export interface PinnedPlaylist {
  url: string;
  name: string;
  imageUrl?: string;
  pinnedAt: number;
}

function normalizeSpotifyUrl(url: string): string {
  return url.trim();
}

export function loadPinnedPlaylists(): PinnedPlaylist[] {
  try {
    const raw = localStorage.getItem(KNIGHT_MUSIC_KEYS.pinnedPlaylists);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const isPinnedPlaylist = (p: PinnedPlaylist | null): p is PinnedPlaylist => p !== null;

    return (parsed as any[])
      .map((p: any): PinnedPlaylist | null => {
        if (!p || typeof p.url !== "string" || typeof p.name !== "string") return null;
        return {
          url: normalizeSpotifyUrl(p.url),
          name: p.name,
          imageUrl: typeof p.imageUrl === "string" ? p.imageUrl : undefined,
          pinnedAt: typeof p.pinnedAt === "number" ? p.pinnedAt : Date.now(),
        };
      })
      .filter(isPinnedPlaylist)
      .sort((a, b) => b.pinnedAt - a.pinnedAt);
  } catch {
    return [];
  }
}

export function savePinnedPlaylists(items: PinnedPlaylist[]): void {
  try {
    localStorage.setItem(KNIGHT_MUSIC_KEYS.pinnedPlaylists, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export function isPlaylistPinned(items: PinnedPlaylist[], url?: string): boolean {
  if (!url) return false;
  const key = normalizeSpotifyUrl(url);
  return items.some((p) => normalizeSpotifyUrl(p.url) === key);
}

export function togglePinnedPlaylist(
  items: PinnedPlaylist[],
  playlist: { url: string; name: string; imageUrl?: string }
): PinnedPlaylist[] {
  const key = normalizeSpotifyUrl(playlist.url);
  const existingIndex = items.findIndex((p) => normalizeSpotifyUrl(p.url) === key);

  if (existingIndex >= 0) {
    const next = items.slice();
    next.splice(existingIndex, 1);
    return next;
  }

  return [
    {
      url: key,
      name: playlist.name,
      imageUrl: playlist.imageUrl,
      pinnedAt: Date.now(),
    },
    ...items,
  ];
}

export function buildPinnedPlaylistsSharePayload(playlists: PinnedPlaylist[]): string {
  const payload = {
    type: "knightmusic:pinned-playlists",
    v: 1,
    playlists: playlists.map((p) => ({ url: p.url, name: p.name, imageUrl: p.imageUrl })),
  };
  return JSON.stringify(payload);
}

export function parsePinnedPlaylistsSharePayload(text: string): PinnedPlaylist[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Accept a single Spotify URL as an import shortcut.
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return [
      {
        url: normalizeSpotifyUrl(trimmed),
        name: trimmed,
        pinnedAt: Date.now(),
      },
    ];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || parsed.type !== "knightmusic:pinned-playlists") return null;
    if (parsed.v !== 1) return null;
    if (!Array.isArray(parsed.playlists)) return null;

    const now = Date.now();
    const out: PinnedPlaylist[] = [];
    for (const item of parsed.playlists) {
      if (!item || typeof item.url !== "string" || typeof item.name !== "string") continue;
      out.push({
        url: normalizeSpotifyUrl(item.url),
        name: item.name,
        imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : undefined,
        pinnedAt: now,
      });
    }

    return out.length ? out : null;
  } catch {
    return null;
  }
}
