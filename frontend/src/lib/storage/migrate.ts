import { KNIGHT_MUSIC_KEYS, LEGACY_SPOTIFLAC_KEYS } from "./keys";

function migrateKey(oldKey: string, newKey: string) {
  try {
    const existingNew = localStorage.getItem(newKey);
    if (existingNew != null) return;

    const oldValue = localStorage.getItem(oldKey);
    if (oldValue == null) return;

    localStorage.setItem(newKey, oldValue);
  } catch {
    // ignore
  }
}

export function migrateLegacyStorageKeys() {
  migrateKey(LEGACY_SPOTIFLAC_KEYS.settings, KNIGHT_MUSIC_KEYS.settings);
  migrateKey(LEGACY_SPOTIFLAC_KEYS.countryCache, KNIGHT_MUSIC_KEYS.countryCache);
  migrateKey(LEGACY_SPOTIFLAC_KEYS.recentSearches, KNIGHT_MUSIC_KEYS.recentSearches);
  migrateKey(LEGACY_SPOTIFLAC_KEYS.fetchHistory, KNIGHT_MUSIC_KEYS.fetchHistory);
  migrateKey(LEGACY_SPOTIFLAC_KEYS.pinnedPlaylists, KNIGHT_MUSIC_KEYS.pinnedPlaylists);
  migrateKey(LEGACY_SPOTIFLAC_KEYS.audioAnalysisState, KNIGHT_MUSIC_KEYS.audioAnalysisState);
  migrateKey(LEGACY_SPOTIFLAC_KEYS.audioConverterState, KNIGHT_MUSIC_KEYS.audioConverterState);
  migrateKey(LEGACY_SPOTIFLAC_KEYS.fileManagerState, KNIGHT_MUSIC_KEYS.fileManagerState);
}
