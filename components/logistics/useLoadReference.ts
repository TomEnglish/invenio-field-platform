import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { belongsToCurrentContext, getQueue, subscribeQueue, type QueueItem } from '@/lib/sync/offlineQueue';
import { refusedChange } from '@/lib/sync/queuePresentation';
import { licenceKnown } from '@/lib/sync/licenceMemory';
import { loadLoad, readCachedLoad } from '@/lib/api/logistics';
import { EMPTY_LOAD, indexLoad, type LoadReference } from '@/lib/logistics/crates';
import { applyChanges, indexLoads } from '@/lib/logistics/loads';

// A pack or unpack saved here changes the copy straight away (see `pending`),
// so a recent download doesn't need repeating each time a crate is shown.
const REFRESH_AFTER_MS = 2 * 60 * 1000;
const OVERLAID = new Set(['pack', 'unpack', 'count', 'load_save', 'load_on', 'load_depart', 'load_off', 'stop_complete', 'licence']);

// Saved packs, unpacks, counts and load changes that still count as happening: the server
// hasn't refused them. Refused ones wait in Sync and change nothing here.
export function waitingChanges(queue: QueueItem[]): { pending: QueueItem[]; refused: QueueItem[] } {
  const mine = queue.filter(item => OVERLAID.has(item.action?.type) && belongsToCurrentContext(item));
  // A licence whose number was forgotten (the app closed before it uploaded) won't go through as it is.
  const lost = (item: QueueItem) => item.action.type === 'licence' && !item.action.payload.recorded && !licenceKnown(item.id);
  const stuck = (item: QueueItem) => refusedChange(item) || lost(item);
  return { pending: mine.filter(item => !stuck(item)), refused: mine.filter(stuck) };
}

// Crates for the active project, reloaded whenever the screen is shown: the
// device copy first, refreshed from the server when online and nothing is
// saved yet, or (with `refresh`) when it is older than two minutes. Changes
// waiting in Sync are laid over it. `reload(true)` always asks. Each reload,
// and each change to the queue, reads the copy and the queue together, one at
// a time, so a change leaving the queue is never missing from both.
export function useLoadReference({ refresh }: { refresh: boolean }) {
  const userId = useAuthStore(s => s.user?.id);
  const projectId = useAuthStore(s => s.activeProject?.id);
  const [base, setBase] = useState<LoadReference>(EMPTY_LOAD);
  const [waiting, setWaiting] = useState<{ pending: QueueItem[]; refused: QueueItem[] }>({ pending: [], refused: [] });
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'online' | 'cache'>('cache');
  const [error, setError] = useState('');
  // Bumped when the screen is left or the account or project changes: older reads are dropped.
  const generation = useRef(0);
  const turn = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { ++generation.current; setBase(EMPTY_LOAD); setWaiting({ pending: [], refused: [] }); }, [userId, projectId]);

  const snapshot = useCallback((ask: 'never' | 'auto' | 'force') => {
    const run = turn.current.then(async () => {
      const id = generation.current;
      const current = () => id === generation.current && useAuthStore.getState().user?.id === userId && useAuthStore.getState().activeProject?.id === projectId;
      if (ask !== 'never') { setLoading(true); setError(''); }
      try {
        let [cached, queue] = await Promise.all([readCachedLoad(), getQueue().catch(() => [] as QueueItem[])]);
        if (!current()) return;
        setBase(cached); setWaiting(waitingChanges(queue));
        const stale = !cached.savedAt || Date.now() - Date.parse(cached.savedAt) > REFRESH_AFTER_MS;
        const online = useNetworkStore.getState().isOnline;
        if (ask === 'never' || !online || !(ask === 'force' || !cached.savedAt || (refresh && stale))) return;
        const result = await loadLoad();
        queue = await getQueue().catch(() => queue);
        if (!current()) return;
        setBase(result.data); setSource(result.source); setError(result.error ?? ''); setWaiting(waitingChanges(queue));
      } catch (e: any) {
        if (current()) setError(e?.message ?? 'Could not load crates');
      } finally {
        if (ask !== 'never' && current()) setLoading(false);
      }
    });
    turn.current = run.catch(() => {});
    return run;
  }, [refresh, userId, projectId]);
  const reload = useCallback((force = false) => snapshot(force ? 'force' : 'auto'), [snapshot]);

  // Reload when shown; follow Sync, since a change that uploads moves from
  // the queue into the saved copy.
  useFocusEffect(useCallback(() => {
    void snapshot('auto');
    const unsubscribe = subscribeQueue(() => { void snapshot('never'); });
    return () => { ++generation.current; setLoading(false); unsubscribe(); };
  }, [snapshot]));

  const { pending, refused } = waiting;
  const data = useMemo(() => applyChanges(base, pending.map(item => item.action)), [base, pending]);
  const index = useMemo(() => indexLoad(data), [data]);
  const loads = useMemo(() => indexLoads(data), [data]);
  // What the server is known to have: the download and changes it accepted since.
  const known = useMemo(() => indexLoad(base), [base]);
  return { data, index, loads, known, base, pending, refused, loading, source, error, reload };
}
