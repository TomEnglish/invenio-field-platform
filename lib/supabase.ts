import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';


const serverRendering = Platform.OS === 'web' && typeof window === 'undefined';
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: serverRendering ? undefined : AsyncStorage,
    autoRefreshToken: !serverRendering,
    persistSession: !serverRendering,
    detectSessionInUrl: false,
  },
});
