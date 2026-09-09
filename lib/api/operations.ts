import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { newOperationId } from '@/lib/utils/operationId';

export interface OperationContext { operationId: string; userId: string; projectId: string }
export function operationContext(operationId = newOperationId()): OperationContext {
  const { user, activeProject, session } = useAuthStore.getState();
  if (!user || !session || !activeProject || activeProject.status !== 'active') throw new Error('Select an assigned active project before making changes.');
  return { operationId, userId: user.id, projectId: activeProject.id };
}
export async function applyOperation(action: string, payload: unknown, context = operationContext()) {
  if (useAuthStore.getState().accessMode !== 'online' || useAuthStore.getState().loading) throw new Error('Reconnect and verify access before uploading. Your saved work will wait in Sync.');
  const current = operationContext(context.operationId);
  if (current.userId !== context.userId || current.projectId !== context.projectId) throw new Error('Account or project changed. Return to the original context to retry.');
  const { data, error } = await supabase.rpc('apply_field_operation', {
    p_operation_id: context.operationId, p_project_id: context.projectId, p_action: action, p_payload: payload,
  });
  if (error) throw new Error(error.message);
  return data;
}
