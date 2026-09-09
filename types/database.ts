export type UserRole = 'field_worker' | 'office_staff' | 'admin';

export type EntityType = 'item' | 'pallet' | 'shipment';

export type ReceivingStatus = 'pending' | 'accepted' | 'partially_accepted' | 'rejected';

export type MaterialCondition = 'good' | 'damaged' | 'mixed';

export type ExceptionType = 'wrong_type' | 'wrong_count' | 'damage';

export type ExceptionResolution = 'hold' | 'return_to_vendor';

export type MaterialStatus = 'in_yard' | 'issued' | 'shipped' | 'depleted';

export type PhotoType = 'damage' | 'general' | 'delivery_ticket';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'completed' | 'archived';
  created_at: string;
}

export interface UserProject {
  user_id: string;
  project_id: string;
  created_at: string;
}

export interface User {
  is_active: boolean;
  invitation_status: 'pending' | 'accepted' | 'cancelled';
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface Location {
  id: string;
  project_id: string;
  zone: string;
  row: string;
  rack: string;
  is_hold_area: boolean;
  capacity: number | null;
  created_at: string;
}

export interface QRCode {
  id: string;
  project_id: string;
  code_value: string;
  entity_type: EntityType;
  entity_id: string | null;
  created_at: string;
}

export interface ReceivingRecord {
  id: string;
  project_id: string;
  qr_code_id: string;
  status: ReceivingStatus;
  material_type: string;
  size: string | null;
  grade: string | null;
  qty: number;
  weight: number | null;
  description: string | null;
  spec: string | null;
  vendor: string | null;
  po_number: string | null;
  delivery_ticket: string | null;
  carrier: string | null;
  condition: MaterialCondition;
  damage_notes: string | null;
  inspection_pass: boolean;
  has_exception: boolean;
  exception_type: ExceptionType | null;
  exception_resolved: boolean;
  exception_resolution: ExceptionResolution | null;
  location_id: string | null;
  created_by: string;
  created_at: string;
}

export interface InspectionPhoto {
  id: string;
  receiving_record_id: string;
  storage_path: string;
  photo_type: PhotoType;
  created_at: string;
}

export interface Material {
  id: string;
  project_id: string;
  receiving_record_id: string;
  qr_code_id: string;
  material_type: string;
  size: string | null;
  grade: string | null;
  qty: number;
  current_quantity: number;
  weight: number | null;
  spec: string | null;
  location_id: string | null;
  status: MaterialStatus;
  created_at: string;
}

export interface MaterialMovement {
  id: string;
  project_id: string;
  material_id: string;
  from_location_id: string | null;
  to_location_id: string;
  moved_by: string;
  reason: string | null;
  created_at: string;
}

export interface MaterialIssue {
  id: string;
  project_id: string;
  material_id: string;
  job_number: string;
  work_order: string | null;
  quantity_issued: number;
  issued_by: string;
  created_at: string;
}

export interface ShipmentOut {
  id: string;
  project_id: string;
  material_id: string;
  destination: string;
  carrier: string | null;
  tracking_number: string | null;
  quantity_shipped: number;
  created_at: string;
}
