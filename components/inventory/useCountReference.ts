import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { EMPTY_REFERENCE, loadCountReference, readCachedReference, type CountReference } from '@/lib/api/inventory';

// Saved counts patch the device copy straight away, so a recent download does
// not need repeating every time Count is shown.
const REFRESH_AFTER_MS = 2 * 60 * 1000;

// Count reference data for the active project, reloaded whenever the screen is
// shown. With `refresh` (Count home) a stale device copy is refreshed from the
// server when online; otherwise (Count item) the server is asked only when
// nothing has been saved yet, or once for each new `check` (something the copy
// can't answer), which `checked` then names. `reload(true)` always asks.
export function useCountReference({ refresh, check = null }: { refresh: boolean; check?: string | null }) {
  const userId = useAuthStore(s => s.user?.id);
  const projectId = useAuthStore(s => s.activeProject?.id);
  const [data, setData] = useState<CountReference>(EMPTY_REFERENCE);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'online' | 'cache'>('cache');
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<string | null>(null);
  const checkedRef = useRef<string | null>(null);
  const request = useRef(0);
  useEffect(() => { checkedRef.current = null; setChecked(null); }, [userId, projectId]);

  const reload = useCallback(async (force = false) => {
    const id = ++request.current;
    const current = () => id === request.current && useAuthStore.getState().user?.id === userId && useAuthStore.getState().activeProject?.id === projectId;
    setLoading(true); setError('');
    try {
      const cached = await readCachedReference();
      if (!current()) return;
      setData(cached);
      const stale = !cached.savedAt || Date.now() - Date.parse(cached.savedAt) > REFRESH_AFTER_MS;
      const verify = !!check && check !== checkedRef.current;
      const ask = useNetworkStore.getState().isOnline && (force || verify || !cached.savedAt || (refresh && stale));
      const result = ask ? await loadCountReference() : { data: cached, source: 'cache' as const, error: undefined };
      if (!current()) return;
      setData(result.data); setSource(result.source); setError(result.error ?? '');
      if (check && result.source === 'online') { checkedRef.current = check; setChecked(check); }
    } catch (e: any) {
      if (current()) setError(e?.message ?? 'Could not load count data');
    } finally {
      if (current()) setLoading(false);
    }
  }, [refresh, userId, projectId, check]);

  // Reload whenever the screen is shown, e.g. after a count has synced, and
  // when there is something new to check.
  useFocusEffect(useCallback(() => {
    void reload();
    return () => { ++request.current; };
  }, [reload]));

  return { data, loading, source, error, reload, checked };
}
