import { create } from 'zustand';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

interface NetworkStore {
  isOnline: boolean;
  setOnline: (online: boolean) => void;
  startListening: () => () => void;
}

export const useNetworkStore = create<NetworkStore>((set) => ({
  isOnline: true,
  setOnline: (online) => set({ isOnline: online }),
  startListening: () => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      set({ isOnline: state.isConnected === true && state.isInternetReachable !== false });
    });
    // Also check immediately
    NetInfo.fetch().then((state) => {
      set({ isOnline: state.isConnected === true && state.isInternetReachable !== false });
    }).catch(() => {});
    return unsubscribe;
  },
}));
