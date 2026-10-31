import { Platform } from 'react-native';
import { newOperationId } from '@/lib/utils/operationId';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NO_PACK_LOCATION, type PackBefore, type PackDraft, type PackEntry, type PackLocation, type PackStart, type UnitKind } from '@/lib/logistics/crates';

// One pack session: a crate label, its details, what goes in and out, and
// where it is. The whole session is queued as one `pack` operation under
// operationId, which changes only once it is saved.
interface PackState extends PackDraft {
  operationId: string;
  step: number;

  setStep: (step: number) => void;
  // `start`: the details and any not-yet-uploaded place or area (see packStart).
  begin: (code: string, before: PackBefore | null, start?: PackStart) => void;
  setDetails: (details: { kind: UnitKind; description: string; isHighValue: boolean }) => void;
  // A scanned tag goes on the list; one that was being taken out stays instead.
  addEntry: (entry: PackEntry) => void;
  dropEntry: (tag: string) => void;
  // What a later server check found about a scanned tag.
  markEntry: (tag: string, patch: Partial<Pick<PackEntry, 'name' | 'unchecked' | 'problem'>>) => void;
  takeOut: (entry: PackEntry) => void;
  keep: (tag: string) => void;
  setLocation: (location: PackLocation) => void;
  reset: () => void;
}

const initialState = {
  operationId: '',
  step: 0,
  code: '',
  before: null as PackBefore | null,
  kind: 'crate' as UnitKind,
  description: '',
  isHighValue: false,
  add: [] as PackEntry[],
  remove: [] as PackEntry[],
  location: NO_PACK_LOCATION,
};

export const usePackStore = create<PackState>()(
  persist(
    (set) => ({
      ...initialState,

      setStep: (step) => set({ step }),
      begin: (code, before, start) => set({
        ...initialState,
        operationId: newOperationId(),
        step: 1,
        code,
        before,
        kind: start?.kind ?? before?.kind ?? 'crate',
        description: start?.description ?? before?.description ?? '',
        isHighValue: start?.isHighValue ?? before?.isHighValue ?? false,
        location: start?.location ?? NO_PACK_LOCATION,
      }),
      setDetails: ({ kind, description, isHighValue }) => set({ kind, description, isHighValue }),
      addEntry: (entry) => set((state) => (state.add.some(e => e.tag === entry.tag) ? state : { add: [...state.add, entry] })),
      dropEntry: (tag) => set((state) => ({ add: state.add.filter(e => e.tag !== tag) })),
      markEntry: (tag, patch) => set((state) => ({ add: state.add.map(e => (e.tag === tag ? { ...e, ...patch } : e)) })),
      takeOut: (entry) => set((state) => (state.remove.some(e => e.tag === entry.tag) ? state : { remove: [...state.remove, entry] })),
      keep: (tag) => set((state) => ({ remove: state.remove.filter(e => e.tag !== tag) })),
      setLocation: (location) => set({ location }),
      reset: () => set({ ...initialState, operationId: newOperationId() }),
    }),
    {
      name: 'pack-draft-unscoped',
      skipHydration: true,
      storage: createJSONStorage(() => Platform.OS === 'web' && typeof window === 'undefined' ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } : AsyncStorage),
    }
  )
);

// Same per-user, per-project draft scoping as stores/countStore.ts.
let draftScope: string | null = null;
let hydration: Promise<void> = Promise.resolve();
export function switchPackScope(userId: string | null, projectId: string | null): Promise<void> {
  const next = userId && projectId ? `pack-draft-${userId}-${projectId}` : null;
  hydration = hydration.catch(() => {}).then(async () => {
    if (next === draftScope) return;
    // Point at an empty key before resetting so the previous draft is not overwritten.
    usePackStore.persist.setOptions({ name: 'pack-draft-unscoped' });
    usePackStore.setState({ ...initialState, operationId: newOperationId() });
    draftScope = next;
    if (next) {
      usePackStore.persist.setOptions({ name: next });
      await usePackStore.persist.rehydrate();
      if (!usePackStore.persist.hasHydrated()) {
        draftScope = null;
        throw new Error('The saved pack draft could not be restored. Its stored data was preserved for recovery.');
      }
      if (!usePackStore.getState().operationId) usePackStore.setState({ operationId: newOperationId() });
    }
  });
  return hydration;
}
