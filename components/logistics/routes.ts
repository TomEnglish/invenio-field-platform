import { useAuthStore } from '@/stores/authStore';

// Field workers use the (field) tabs; office staff and admins the (office) tabs.
export type GroupRoute = 'crate' | 'pack' | 'loads' | 'load' | 'load-edit' | 'load-checkin' | 'load-out' | 'load-depart' | 'load-unload';
export function groupRoute(name: GroupRoute): string {
  return `${useAuthStore.getState().user?.role === 'field_worker' ? '/(field)' : '/(office)'}/${name}`;
}
