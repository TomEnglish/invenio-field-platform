import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Scans waiting to be saved as one queued operation. They are saved when
// BATCH_SIZE have built up, BATCH_WAIT_MS after the first, when `flush` is
// called, when the screen is left and when the app goes to the background, so
// a crash loses a few seconds at most. `flush` says whether everything taken
// so far was saved: steps that depend on the scans (Depart, Finish stop) stop
// when it wasn't.
export const BATCH_SIZE = 10;
export const BATCH_WAIT_MS = 5000;
interface Batching<T> {
  empty: () => T;
  count: (batch: T) => number;
  // A failed save's scans go back in front of any taken since.
  merge: (failed: T, since: T) => T;
  save: (batch: T) => Promise<void>;
}
export function useScanBatch<T>({ empty, count, merge, save }: Batching<T>) {
  const [batch, setBatch] = useState<T>(empty);
  const current = useRef(batch);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean>>(Promise.resolve(true));
  const latest = useRef({ count, merge, save, empty });
  latest.current = { count, merge, save, empty };
  const [error, setError] = useState('');
  const put = (next: T) => { current.current = next; setBatch(next); };

  // One save at a time, in scan order.
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const taken = current.current;
    if (latest.current.count(taken) === 0) return saving.current.then(() => latest.current.count(current.current) === 0);
    put(latest.current.empty());
    saving.current = saving.current.then(() => latest.current.save(taken)).then(() => { setError(''); return true; }, (e: any) => {
      setError(`Could not save the last scans: ${e?.message ?? 'Please try again'}. They are still listed.`);
      put(latest.current.merge(taken, current.current));
      return false;
    });
    return saving.current;
  }, []);

  const update = useCallback((change: (batch: T) => T) => {
    put(change(current.current));
    const n = latest.current.count(current.current);
    if (n >= BATCH_SIZE) void flush();
    else if (n > 0 && !timer.current) timer.current = setTimeout(() => { timer.current = null; void flush(); }, BATCH_WAIT_MS);
  }, [flush]);

  useFocusEffect(useCallback(() => () => { void flush(); }, [flush]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') void flush(); });
    return () => { subscription.remove(); void flush(); };
  }, [flush]);
  return { batch, update, flush, error };
}
