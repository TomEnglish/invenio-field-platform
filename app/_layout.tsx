import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppState, Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { supabase } from '@/lib/supabase';
import { useAuthStore, handleSignedOut } from '@/stores/authStore';
import { useEffect } from 'react';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { startAutoSync } from '@/lib/sync/syncManager';
import { AppErrorBoundary } from '@/components/ui/ErrorBoundary';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        handleSignedOut();
      } else if (event === 'TOKEN_REFRESHED' && session) {
        useAuthStore.setState({ session: { access_token: session.access_token } });
      }
    });
    const refresh = () => {
      if (useAuthStore.getState().user && useNetworkStore.getState().isOnline) void useAuthStore.getState().loadSession();
    };
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    if (Platform.OS === 'web') window.addEventListener('focus', refresh);
    return () => { subscription.unsubscribe(); foreground.remove(); if (Platform.OS === 'web') window.removeEventListener('focus', refresh); };
  }, []);

  // Start network monitoring and auto-sync
  useEffect(() => {
    const unsubNetwork = useNetworkStore.getState().startListening();
    const unsubSync = startAutoSync();
    return () => {
      unsubNetwork();
      unsubSync();
    };
  }, []);

  if (!loaded) {
    return null;
  }

  // Gesture root for the site-plan pinch, pan and tap (native in build 5+).
  return (
    <GestureHandlerRootView style={styles.root}>
      <AppErrorBoundary>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(field)" />
          <Stack.Screen name="(office)" />
        </Stack>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
