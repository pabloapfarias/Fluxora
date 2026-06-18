import { useCallback, useEffect, useRef, useState } from "react";

const RECENT_STORAGE_KEY = "fluxora:commandPalette:recents";
const FAVORITES_STORAGE_KEY = "fluxora:commandPalette:favorites";
const PREFIX_HISTORY_KEY = "fluxora:commandPalette:prefixHistory";
const MAX_RECENTS = 8;
const MAX_PREFIX_HISTORY = 6;

function readStoredList(storage: Storage | null, key: string): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((value) => typeof value === "string");
  } catch {
    // ignore parse errors
  }
  return [];
}

function writeStoredList(storage: Storage | null, key: string, value: string[]) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

export function useCommandPaletteHistory() {
  const [recents, setRecents] = useState<string[]>(() =>
    readStoredList(typeof window !== "undefined" ? window.localStorage : null, RECENT_STORAGE_KEY)
  );
  const [favorites, setFavorites] = useState<string[]>(() =>
    readStoredList(typeof window !== "undefined" ? window.localStorage : null, FAVORITES_STORAGE_KEY)
  );
  const [prefixHistory, setPrefixHistory] = useState<string[]>(() =>
    readStoredList(typeof window !== "undefined" ? window.localStorage : null, PREFIX_HISTORY_KEY)
  );
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    writeStoredList(window.localStorage, RECENT_STORAGE_KEY, recents);
  }, [recents]);

  useEffect(() => {
    writeStoredList(window.localStorage, FAVORITES_STORAGE_KEY, favorites);
  }, [favorites]);

  useEffect(() => {
    writeStoredList(window.localStorage, PREFIX_HISTORY_KEY, prefixHistory);
  }, [prefixHistory]);

  const recordUsage = useCallback((actionId: string) => {
    setRecents((current) => {
      const filtered = current.filter((id) => id !== actionId);
      return [actionId, ...filtered].slice(0, MAX_RECENTS);
    });
  }, []);

  const recordPrefix = useCallback((prefix: string) => {
    if (!prefix || !prefix.startsWith("/")) return;
    setPrefixHistory((current) => {
      const filtered = current.filter((entry) => entry !== prefix);
      return [prefix, ...filtered].slice(0, MAX_PREFIX_HISTORY);
    });
  }, []);

  const toggleFavorite = useCallback((actionId: string) => {
    setFavorites((current) => {
      if (current.includes(actionId)) {
        return current.filter((id) => id !== actionId);
      }
      return [...current, actionId];
    });
  }, []);

  const isFavorite = useCallback((actionId: string) => favorites.includes(actionId), [favorites]);

  return {
    recents,
    favorites,
    prefixHistory,
    isFavorite,
    toggleFavorite,
    recordUsage,
    recordPrefix,
  };
}
