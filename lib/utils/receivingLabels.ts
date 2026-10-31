import type { ExceptionType, MaterialCondition, PhotoType } from '@/types/database';

// The words for each receiving step and choice. The steps and Review both use
// these, so a choice reads the same wherever it shows.
export const RECEIVING_STEPS = ['Material details', 'PO / delivery', 'Photos', 'Inspection', 'Decision', 'Location', 'Review'];

export type DecisionStatus = 'accepted' | 'partially_accepted' | 'rejected';
type Option<V extends string> = { value: V; label: string };

export const PHOTO_TYPES: Option<PhotoType>[] = [
  { value: 'general', label: 'General' },
  { value: 'damage', label: 'Damage' },
  { value: 'delivery_ticket', label: 'Delivery Ticket' },
];
export const CONDITIONS: Option<MaterialCondition>[] = [
  { value: 'good', label: 'Good' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'mixed', label: 'Mixed' },
];
export const DECISIONS: Option<DecisionStatus>[] = [
  { value: 'accepted', label: 'Accept' },
  { value: 'partially_accepted', label: 'Partial Accept' },
  { value: 'rejected', label: 'Reject' },
];
export const EXCEPTION_TYPES: Option<ExceptionType>[] = [
  { value: 'wrong_type', label: 'Wrong Type' },
  { value: 'wrong_count', label: 'Wrong Count' },
  { value: 'damage', label: 'Damage' },
];

export const labelOf = <V extends string>(options: Option<V>[], value: V | null | undefined): string | undefined =>
  options.find(option => option.value === value)?.label;
