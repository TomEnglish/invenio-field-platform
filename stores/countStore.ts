import { Platform } from 'react-native';
import { newOperationId } from '@/lib/utils/operationId';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CountCategoryChoice, CountDraft, CountItemData, CountLocation, CountMatch, CountPhoto } from '@/lib/inventory/count';
import type { MapView } from '@/lib/inventory/siteMap';

interface CountState {
  operationId: string;
  step: number;
  tag: string;
  match: CountMatch | null;
  item: CountItemData;
  category: CountCategoryChoice;
  location: CountLocation;
  // Last zoom/pan per site plan, kept for "Count next".
  mapView: { mapId: string; view: MapView } | null;
  photos: CountPhoto[];

  setStep: (step: number) => void;
  start: (tag: string, prefill?: { match: CountMatch | null; item?: Partial<CountItemData>; category?: CountCategoryChoice | null; location?: CountLocation | null }) => void;
  setItem: (item: CountItemData) => void;
  setCategory: (category: CountCategoryChoice) => void;
  setLocation: (location: CountLocation) => void;
  setMapView: (mapView: { mapId: string; view: MapView } | null) => void;
  addPhoto: (photo: CountPhoto) => void;
  removePhoto: (index: number) => void;
  // Reopens a count the server refused (from Sync), under a new operation ID.
  restore: (draft: CountDraft, step: number) => void;
  // Clears the item but keeps the category, site plan, map view and zone.
  countNext: () => void;
  reset: () => void;
}

const emptyItem: CountItemData = { name: '', description: '', partNumber: '', quantity: '1', uom: 'EA', condition: 'good', notes: '' };
const emptyCategory: CountCategoryChoice = { categoryId: null, proposed: null, label: '' };
const emptyLocation: CountLocation = { siteMapId: null, pin: null, zoneId: null, zoneName: '' };

const initialState = {
  operationId: '',
  step: 0,
  tag: '',
  match: null as CountMatch | null,
  item: emptyItem,
  category: emptyCategory,
  location: emptyLocation,
  mapView: null as CountState['mapView'],
  photos: [] as CountPhoto[],
};

export const useCountStore = create<CountState>()(
  persist(
    (set) => ({
      ...initialState,

      setStep: (step) => set({ step }),
      start: (tag, prefill) => set((state) => ({
        step: 0,
        tag,
        match: prefill?.match ?? null,
        item: { ...emptyItem, ...prefill?.item },
        // A matched record's own category and location win over the last ones.
        category: prefill?.category ?? state.category,
        location: prefill?.location ?? { ...state.location, pin: null },
        photos: [],
      })),
      setItem: (item) => set({ item }),
      setCategory: (category) => set({ category }),
      setLocation: (location) => set({ location }),
      setMapView: (mapView) => set({ mapView }),
      addPhoto: (photo) => set((state) => ({ photos: [...state.photos, photo] })),
      removePhoto: (index) => set((state) => ({ photos: state.photos.filter((_, i) => i !== index) })),
      restore: (draft, step) => set({ ...draft, step, operationId: newOperationId() }),
      countNext: () => set((state) => ({
        ...initialState,
        operationId: newOperationId(),
        category: state.category,
        location: { ...state.location, pin: null },
        mapView: state.mapView,
      })),
      reset: () => set({ ...initialState, operationId: newOperationId() }),
    }),
    {
      name: 'count-draft-unscoped',
      skipHydration: true,
      storage: createJSONStorage(() => Platform.OS === 'web' && typeof window === 'undefined' ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } : AsyncStorage),
    }
  )
);

// Same per-user, per-project draft scoping as stores/receivingStore.ts.
let draftScope: string | null = null;
let hydration: Promise<void> = Promise.resolve();
export function switchCountScope(userId: string | null, projectId: string | null): Promise<void> {
  const next = userId && projectId ? `count-draft-${userId}-${projectId}` : null;
  hydration = hydration.catch(() => {}).then(async () => {
    if (next === draftScope) return;
    // Point at an empty key before resetting so the previous draft is not overwritten.
    useCountStore.persist.setOptions({ name: 'count-draft-unscoped' });
    useCountStore.setState({ ...initialState, operationId: newOperationId() });
    draftScope = next;
    if (next) {
      useCountStore.persist.setOptions({ name: next });
      await useCountStore.persist.rehydrate();
      if (!useCountStore.persist.hasHydrated()) {
        draftScope = null;
        throw new Error('The saved count draft could not be restored. Its stored data was preserved for recovery.');
      }
      if (!useCountStore.getState().operationId) useCountStore.setState({ operationId: newOperationId() });
    }
  });
  return hydration;
}
