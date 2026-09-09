import { materialStepSchema, poStepSchema, inspectionStepSchema, locationStepSchema, decisionStepSchema, photoStepSchema } from './validation';
import type { useReceivingStore } from '@/stores/receivingStore';

type Draft = Pick<ReturnType<typeof useReceivingStore.getState>, 'qrCodeValue' | 'material' | 'po' | 'inspection' | 'location' | 'decision' | 'photos'>;
export function receivingReviewIssue(draft: Draft): { step: number; message: string } | null {
  const checks = [
    { step: 0, result: materialStepSchema.safeParse(draft.material) },
    { step: 1, result: poStepSchema.safeParse(draft.po) },
    { step: 2, result: photoStepSchema.safeParse({ photos: draft.photos }) },
    { step: 3, result: inspectionStepSchema.safeParse(draft.inspection) },
    { step: 4, result: decisionStepSchema.safeParse(draft.decision) },
    { step: 5, result: locationStepSchema.safeParse(draft.location) },
  ];
  for (const { step, result } of checks) if (!result.success) return { step, message: result.error.issues[0].message };
  if (!draft.qrCodeValue.trim()) return { step: 0, message: 'A QR code is required. Return to Scan to select a label.' };
  const accepted = draft.decision.accepted_qty;
  if (draft.decision.status === 'partially_accepted' && (!Number.isInteger(accepted) || !accepted || accepted >= draft.material.qty)) {
    return { step: 4, message: 'Accepted quantity must be greater than zero and smaller than the delivered quantity. Review your decision after changing the material quantity.' };
  }
  if ((draft.inspection.condition === 'damaged' || !draft.inspection.inspection_pass) && !draft.decision.has_exception) {
    return { step: 4, message: 'The updated inspection requires an exception. Review the decision before submitting.' };
  }
  return null;
}
