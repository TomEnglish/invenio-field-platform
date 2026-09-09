import { supabase } from '@/lib/supabase';
import type { Project, User } from '@/types/database';
import { switchReceivingScope } from './receivingStore';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  user: User | null;
  session: { access_token: string } | null;
  loading: boolean;
  activeProject: Project | null;
  availableProjects: Project[];
  setActiveProject: (projectId: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  loadSession: () => Promise<void>;
}
const cleared = { user: null, session: null, activeProject: null, availableProjects: [] };
let revision = 0;
async function loadAccess(session: { access_token: string; user: { id: string } }) {
  const { data: profile, error } = await supabase.from('users').select('*').eq('id', session.user.id).single();
  if (error || !profile?.is_active || profile.invitation_status !== 'accepted') throw new Error('Access is inactive or invitation setup is incomplete. Contact your administrator.');
  const { data, error: projectError } = await supabase.from('user_projects').select('projects(*)').eq('user_id', session.user.id);
  if (projectError) throw new Error('Could not verify project access. Please retry.');
  const availableProjects = (data ?? []).map((up: any) => up.projects as Project).filter(p => p && p.status !== 'archived');
  const saved = await AsyncStorage.getItem(`active-project-${session.user.id}`);
  const activeProject = availableProjects.find(p => p.id === saved) ?? availableProjects[0] ?? null;
  return { user: profile as User, session: { access_token: session.access_token }, availableProjects, activeProject };
}
export const useAuthStore = create<AuthState>((set, get) => ({
  ...cleared, loading: true,
  setActiveProject: async (id) => {
    const project = get().availableProjects.find(p => p.id === id);
    const user = get().user;
    if (!project || !user || project.id === get().activeProject?.id) return;
    const version = ++revision;
    set({ activeProject: null, loading: true });
    await AsyncStorage.setItem(`active-project-${user.id}`, id);
    await switchReceivingScope(user.id, id);
    if (version === revision) set({ activeProject: project, loading: false });
  },
  signIn: async (email, password) => {
    const version = ++revision;
    set({ ...cleared, loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error(error?.message ?? 'Sign in failed');
      const access = await loadAccess(data.session);
      if (version !== revision) return { error: 'Session changed. Please retry.' };
      await switchReceivingScope(access.user.id, access.activeProject?.id ?? null);
      if (version === revision) set({ ...access, loading: false });
      return { error: null };
    } catch (error: any) {
      if (version === revision) { await supabase.auth.signOut(); set({ ...cleared, loading: false }); }
      return { error: error?.message ?? 'Check your connection and retry.' };
    }
  },
  signOut: async () => {
    ++revision;
    set({ ...cleared, loading: false });
    await switchReceivingScope(null, null);
    await supabase.auth.signOut();
  },
  loadSession: async () => {
    const version = ++revision;
    set({ loading: true });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');
      const access = await loadAccess(session);
      if (version !== revision) return;
      await switchReceivingScope(access.user.id, access.activeProject?.id ?? null);
      if (version === revision) set({ ...access, loading: false });
    } catch {
      if (version === revision) {
        set({ ...cleared, loading: false });
        await switchReceivingScope(null, null);
      }
    }
  },
}));
