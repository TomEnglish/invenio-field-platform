import { switchReceivingScope } from './receivingStore';
import { switchCountScope } from './countStore';

// Every persisted field draft follows the signed-in account and active project.
// Both switches finish before a failure is reported, so a retry starts clean.
export async function switchFieldScopes(userId: string | null, projectId: string | null): Promise<void> {
  const results = await Promise.allSettled([
    switchReceivingScope(userId, projectId),
    switchCountScope(userId, projectId),
  ]);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
}
