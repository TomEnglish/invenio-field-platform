import { useAuthStore } from '@/stores/authStore';

// Field workers use the (field) tabs; office staff and admins the (office) tabs.
export function groupRoute(name: 'crate' | 'pack'): string {
  return `${useAuthStore.getState().user?.role === 'field_worker' ? '/(field)' : '/(office)'}/${name}`;
}
