import { supabase } from '@/lib/supabase';
import type { Project, User } from '@/types/database';
import { switchReceivingScope } from './receivingStore';
import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  user: User | null;
  session: { access_token: string } | null;
  loading: boolean;
  accessMode: 'online' | 'offline' | null;
  activeProject: Project | null;
  availableProjects: Project[];
  setActiveProject: (projectId: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  loadSession: () => Promise<void>;
}
const cleared = { user: null, session: null, activeProject: null, availableProjects: [], accessMode: null };
const accessKey = (userId: string) => `verified-offline-access-${userId}`;
export async function clearOfflineAccess(userId: string | null | undefined) {
  if (userId) await AsyncStorage.removeItem(accessKey(userId));
}
let revision = 0;
type Session = { access_token: string; user: { id: string }; expires_at?: number };
class AccessDenied extends Error {}
function denied(error: { code?: string } | null, status?: number) {
  return status === 401 || status === 403 || ['42501', 'PGRST301', 'PGRST302', 'PGRST303', 'PGRST116'].includes(error?.code ?? '');
}
async function confirmedOffline() {
  const network = await NetInfo.fetch().catch(() => null);
  return network?.isConnected === false || network?.isInternetReachable === false;
}
async function loadAccess(session: Session, version: number) {
  if (session.expires_at !== undefined && session.expires_at <= Date.now() / 1000) throw new AccessDenied('Reconnect to refresh your session. Saved work is preserved.');
  const offline = await confirmedOffline();
  let profile: User, availableProjects: Project[], accessMode: 'online' | 'offline';
  try {
    if (offline) throw new Error('Offline');
    const { data, error, status } = await supabase.from('users').select('*').eq('id', session.user.id).single();
    if (version !== revision) throw new Error('Session changed. Please retry.');
    if (denied(error, status)) throw new AccessDenied('Account access was denied. Reconnect and sign in again.');
    if (error) throw new Error('Could not verify account access. Please retry.');
    if (!data || data.id !== session.user.id || !data.is_active || data.invitation_status !== 'accepted') throw new AccessDenied('Access is inactive or invitation setup is incomplete. Contact your administrator.');
    const result = await supabase.from('user_projects').select('projects(*)').eq('user_id', session.user.id);
    if (version !== revision) throw new Error('Session changed. Please retry.');
    if (denied(result.error, result.status)) throw new AccessDenied('Project access was denied. Reconnect and sign in again.');
    if (result.error) throw new Error('Could not verify project access. Please retry.');
    if (version !== revision) throw new Error('Session changed. Please retry.');
    profile = data as User;
    availableProjects = (result.data ?? []).map((up: any) => up.projects as Project).filter(p => p && p.status !== 'archived');
    accessMode = 'online';
    // No credentials are duplicated here. This snapshot only unlocks local work
    // for the matching, still-present session; server writes require revalidation.
    await AsyncStorage.setItem(accessKey(profile.id), JSON.stringify({ user: profile, projects: availableProjects })).catch(() => {});
  } catch (error) {
    if (error instanceof AccessDenied) { if (version === revision) await clearOfflineAccess(session.user.id); throw error; }
    if (!offline && !(await confirmedOffline())) throw error;
    const raw = await AsyncStorage.getItem(accessKey(session.user.id));
    const saved = raw ? JSON.parse(raw) : null;
    if (saved?.user?.id !== session.user.id || saved.user.is_active !== true || saved.user.invitation_status !== 'accepted'
        || !['admin', 'office_staff', 'field_worker'].includes(saved.user.role) || !Array.isArray(saved.projects)
        || saved.projects.some((p: Project) => !p?.id || !['active', 'completed'].includes(p.status))) {
      throw new Error('Sign in online once to enable offline recovery on this device. Saved work is preserved.');
    }
    profile = saved.user; availableProjects = saved.projects; accessMode = 'offline';
  }
  const savedProject = await AsyncStorage.getItem(`active-project-${session.user.id}`);
  const activeProject = availableProjects.find(p => p.id === savedProject) ?? availableProjects[0] ?? null;
  return { user: profile, session: { access_token: session.access_token }, availableProjects, activeProject, accessMode };
}
export const useAuthStore = create<AuthState>((set, get) => ({
  ...cleared, loading: true,
  setActiveProject: async (id) => {
    const previous = get().activeProject;
    const project = get().availableProjects.find(p => p.id === id);
    const user = get().user;
    if (!project || !user || project.id === previous?.id) return;
    const version = ++revision;
    set({ activeProject: null, loading: true });
    try {
      await AsyncStorage.setItem(`active-project-${user.id}`, id);
      if (version !== revision) return;
      await switchReceivingScope(user.id, id);
      if (version === revision) set({ activeProject: project, loading: false });
    } catch (error) {
      if (version === revision) {
        let restored = false;
        try {
          await switchReceivingScope(user.id, previous?.id ?? null);
          if (previous) await AsyncStorage.setItem(`active-project-${user.id}`, previous.id);
          restored = true;
        } catch { /* Keep the workspace closed if its draft cannot be restored. */ }
        if (version === revision) set({ activeProject: restored ? previous : null, loading: false });
      }
      throw error;
    }
  },
  signIn: async (email, password) => {
    const version = ++revision;
    set({ ...cleared, loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error(error?.message ?? 'Sign in failed');
      const access = await loadAccess(data.session, version);
      if (version !== revision) return { error: 'Session changed. Please retry.' };
      await switchReceivingScope(access.user.id, access.activeProject?.id ?? null);
      if (version !== revision) return { error: 'Session changed. Please retry.' };
      set({ ...access, loading: false });
      return { error: null };
    } catch (error: any) {
      if (version === revision) {
        set({ ...cleared, loading: false });
        await switchReceivingScope(null, null).catch(() => {});
        await supabase.auth.signOut().catch(() => {});
      }
      return { error: error?.message ?? 'Check your connection and retry.' };
    }
  },
  signOut: async () => {
    const userId = get().user?.id;
    const version = ++revision;
    set({ ...cleared, loading: true });
    // Begin SDK sign-out before another sign-in can acquire its session lock.
    const signedOut = supabase.auth.signOut();
    try {
      await clearOfflineAccess(userId);
      if (version === revision) await switchReceivingScope(null, null);
      const result = await signedOut;
      if (result.error) throw result.error;
    } finally {
      if (version === revision) set({ loading: false });
    }
  },
  loadSession: async () => {
    const version = ++revision;
    set({ loading: true });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');
      const access = await loadAccess(session, version);
      if (version !== revision) return;
      await switchReceivingScope(access.user.id, access.activeProject?.id ?? null);
      if (version === revision) set({ ...access, loading: false });
    } catch {
      if (version === revision) {
        set({ ...cleared, loading: false });
        await switchReceivingScope(null, null).catch(() => {});
      }
    }
  },
}));

// SDK sign-out events invalidate in-flight access requests as well as the view.
export function handleSignedOut() {
  const userId = useAuthStore.getState().user?.id;
  ++revision;
  useAuthStore.setState({ ...cleared, loading: false });
  void clearOfflineAccess(userId).catch(() => {});
  void switchReceivingScope(null, null).catch(() => {});
}
