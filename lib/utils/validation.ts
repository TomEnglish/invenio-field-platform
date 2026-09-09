import { z } from 'zod';

export const materialStepSchema = z.object({
  material_type: z.string().min(1, 'Material type is required'),
  size: z.string().optional(),
  grade: z.string().optional(),
  qty: z.number().int().min(1, 'Quantity must be at least 1'),
  weight: z.number().min(0).optional(),
  description: z.string().optional(),
  spec: z.string().optional(),
});

export const poStepSchema = z.object({
  vendor: z.string().optional(),
  po_number: z.string().optional(),
  delivery_ticket: z.string().optional(),
  carrier: z.string().optional(),
});

export const inspectionStepSchema = z.object({
  condition: z.enum(['good', 'damaged', 'mixed']),
  damage_notes: z.string().optional(),
  inspection_pass: z.boolean(),
});

export const photoStepSchema = z.object({
  photos: z.array(z.object({
    uri: z.string(),
    photo_type: z.enum(['damage', 'general', 'delivery_ticket']),
  })),
});

export const locationStepSchema = z.object({
  location_id: z.string().min(1, 'Location is required'),
});

export const decisionStepSchema = z.object({
  status: z.enum(['accepted', 'partially_accepted', 'rejected']),
  accepted_qty: z.number().int().positive().optional(),
  has_exception: z.boolean(),
  exception_type: z.enum(['wrong_type', 'wrong_count', 'damage']).optional(),
});

export type MaterialStepData = z.infer<typeof materialStepSchema>;
export type POStepData = z.infer<typeof poStepSchema>;
export type InspectionStepData = z.infer<typeof inspectionStepSchema>;
export type PhotoStepData = z.infer<typeof photoStepSchema>;
export type LocationStepData = z.infer<typeof locationStepSchema>;
export type DecisionStepData = z.infer<typeof decisionStepSchema>;
