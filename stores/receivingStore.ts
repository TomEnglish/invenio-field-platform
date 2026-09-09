import { Platform } from 'react-native';
import { newOperationId } from '@/lib/utils/operationId';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  MaterialStepData,
  POStepData,
  InspectionStepData,
  PhotoStepData,
  LocationStepData,
  DecisionStepData,
} from '@/lib/utils/validation';

export interface PhotoEntry {
  uri: string;
  photo_type: 'damage' | 'general' | 'delivery_ticket';
}

interface ReceivingState {
  operationId: string;
  // Current wizard state
  step: number;
  qrCodeValue: string;
  qrCodeId: string | null;

  // Step data
  material: MaterialStepData;
  po: POStepData;
  inspection: InspectionStepData;
  photos: PhotoEntry[];
  location: LocationStepData;
  locationLabel: string;
  decision: DecisionStepData;

  // Actions
  setStep: (step: number) => void;
  setQRCode: (codeValue: string, id: string | null) => void;
  setMaterial: (data: MaterialStepData) => void;
  setPO: (data: POStepData) => void;
  setInspection: (data: InspectionStepData) => void;
  addPhoto: (photo: PhotoEntry) => void;
  removePhoto: (index: number) => void;
  setLocation: (data: LocationStepData, label?: string) => void;
  setDecision: (data: DecisionStepData) => void;
  reset: () => void;
}

const initialState = {
  operationId: '',
  step: 0,
  qrCodeValue: '',
  qrCodeId: null as string | null,
  material: {
    material_type: '',
    qty: 1,
  } as MaterialStepData,
  po: {} as POStepData,
  inspection: {
    condition: 'good' as const,
    inspection_pass: true,
  } as InspectionStepData,
  photos: [] as PhotoEntry[],
  locationLabel: '',
  location: {
    location_id: '',
  } as LocationStepData,
  decision: {
    status: 'accepted' as const,
    has_exception: false,
  } as DecisionStepData,
};

export const useReceivingStore = create<ReceivingState>()(
  persist(
    (set) => ({
      ...initialState,

      setStep: (step) => set({ step }),
      setQRCode: (qrCodeValue, qrCodeId) => set({ qrCodeValue, qrCodeId }),
      setMaterial: (material) => set({ material }),
      setPO: (po) => set({ po }),
      setInspection: (inspection) => set({ inspection }),
      addPhoto: (photo) =>
        set((state) => ({ photos: [...state.photos, photo] })),
      removePhoto: (index) =>
        set((state) => ({
          photos: state.photos.filter((_, i) => i !== index),
        })),
      setLocation: (location, locationLabel = '') => set({ location, locationLabel }),
      setDecision: (decision) => set({ decision }),
      reset: () => set({ ...initialState, operationId: newOperationId() }),
    }),
    {
      name: 'receiving-wizard-unscoped',
      skipHydration: true,
      storage: createJSONStorage(() => Platform.OS === 'web' && typeof window === 'undefined' ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } : AsyncStorage),
    }
  )
);

// Save each draft independently; the legacy unscoped key is intentionally retained.
let draftScope: string | null = null;
let hydration: Promise<void> = Promise.resolve();
export function switchReceivingScope(userId: string | null, projectId: string | null): Promise<void> {
  const next = userId && projectId ? `receiving-wizard-${userId}-${projectId}` : null;
  hydration = hydration.catch(() => {}).then(async () => {
    if (next === draftScope) return;
    // Point at an empty key before resetting so the previous draft is not overwritten.
    useReceivingStore.persist.setOptions({ name: 'receiving-wizard-unscoped' });
    useReceivingStore.setState({ ...initialState, operationId: newOperationId() });
    draftScope = next;
    if (next) {
      useReceivingStore.persist.setOptions({ name: next });
      await useReceivingStore.persist.rehydrate();
      if (!useReceivingStore.persist.hasHydrated()) {
        draftScope = null;
        throw new Error('The saved receiving draft could not be restored. Its stored data was preserved for recovery.');
      }
      if (!useReceivingStore.getState().operationId) useReceivingStore.setState({ operationId: newOperationId() });
    }
  });
  return hydration;
}
