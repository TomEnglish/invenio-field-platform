import { Platform } from 'react-native';
import { newOperationId } from '@/lib/utils/operationId';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CheckInCompany, CheckInDraft } from '@/lib/logistics/loads';

// One driver check-in for one load. The driver, companies and photo files
// survive a restart; the licence number is never written to storage (see
// `partialize`), so after a restart it is typed again. Saving queues two
// items under saveId and licenceId, which change only once saved.
interface CheckInState extends CheckInDraft {
  loadId: string;
  step: number;
  saveId: string;
  licenceId: string;
  // What the check-in began with: only changes from it are sent.
  start: Pick<CheckInDraft, 'driverName' | 'driverPhone' | 'companies'> | null;

  begin: (loadId: string, start: Pick<CheckInDraft, 'driverName' | 'driverPhone' | 'companies'>) => void;
  setStep: (step: number) => void;
  set: (patch: Partial<CheckInDraft>) => void;
  setCompany: (index: number, company: CheckInCompany) => void;
  addCompany: () => void;
  removeCompany: (index: number) => void;
  reset: () => void;
}

const initialState: Omit<CheckInState, 'begin' | 'setStep' | 'set' | 'setCompany' | 'addCompany' | 'removeCompany' | 'reset'> = {
  loadId: '', step: 0, saveId: '', licenceId: '', start: null,
  driverName: '', driverPhone: '', companies: [], licenceNumber: '', licenceState: '', licenceExpiry: '', front: null, back: null,
};
const fresh = () => ({ ...initialState, saveId: newOperationId(), licenceId: newOperationId() });

export const useCheckInStore = create<CheckInState>()(
  persist(
    (set) => ({
      ...initialState,
      begin: (loadId, start) => set({ ...fresh(), loadId, ...start, companies: start.companies.map(company => ({ ...company })), start: { ...start, companies: start.companies.map(company => ({ ...company })) } }),
      setStep: (step) => set({ step }),
      set: (patch) => set(patch),
      setCompany: (index, company) => set((state) => ({ companies: state.companies.map((c, i) => (i === index ? company : c)) })),
      addCompany: () => set((state) => (state.companies.length >= 3 ? state : { companies: [...state.companies, { name: '', role: 'carrier', contactName: '', phone: '' }] })),
      removeCompany: (index) => set((state) => ({ companies: state.companies.filter((_, i) => i !== index) })),
      reset: () => set(fresh()),
    }),
    {
      name: 'checkin-draft-unscoped',
      skipHydration: true,
      // Never the licence number.
      partialize: ({ licenceNumber: _number, ...rest }) => rest,
      storage: createJSONStorage(() => Platform.OS === 'web' && typeof window === 'undefined' ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } : AsyncStorage),
    }
  )
);

// Same per-user, per-project draft scoping as stores/countStore.ts.
let draftScope: string | null = null;
let hydration: Promise<void> = Promise.resolve();
export function switchCheckInScope(userId: string | null, projectId: string | null): Promise<void> {
  const next = userId && projectId ? `checkin-draft-${userId}-${projectId}` : null;
  hydration = hydration.catch(() => {}).then(async () => {
    if (next === draftScope) return;
    useCheckInStore.persist.setOptions({ name: 'checkin-draft-unscoped' });
    useCheckInStore.setState(fresh());
    draftScope = next;
    if (next) {
      useCheckInStore.persist.setOptions({ name: next });
      await useCheckInStore.persist.rehydrate();
      if (!useCheckInStore.persist.hasHydrated()) {
        draftScope = null;
        throw new Error('The saved check-in could not be restored. Its stored data was preserved for recovery.');
      }
      if (!useCheckInStore.getState().saveId) useCheckInStore.setState({ saveId: newOperationId(), licenceId: newOperationId() });
    }
  });
  return hydration;
}
