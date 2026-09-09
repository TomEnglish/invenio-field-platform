import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuthStore } from '@/stores/authStore';
function cacheKey(key: string) {
  const { user, activeProject, session } = useAuthStore.getState();
  return user && session && activeProject ? `cache_${user.id}_${activeProject.id}_${key}` : null;
}
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const scoped = cacheKey(key);
    if (!scoped) return null;
    const raw = await AsyncStorage.getItem(scoped);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    // Return cached data even if stale (offline needs it)
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    const scoped = cacheKey(key);
    if (scoped) await AsyncStorage.setItem(scoped, JSON.stringify(entry));
  } catch {}
}

export async function isCacheFresh(key: string): Promise<boolean> {
  try {
    const scoped = cacheKey(key);
    if (!scoped) return false;
    const raw = await AsyncStorage.getItem(scoped);
    if (!raw) return false;
    const entry = JSON.parse(raw);
    return Date.now() - entry.timestamp < CACHE_TTL;
  } catch {
    return false;
  }
}
