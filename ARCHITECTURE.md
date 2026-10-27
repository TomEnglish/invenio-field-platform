# QR Asset Scanner — Architecture

## Overview

Mobile app for managing material receiving and lifecycle in a laydown yard. Field workers scan QR codes on arriving material, fill out inspection/receiving forms, and flag exceptions. Office staff review exceptions, manage inventory, and monitor the yard. Full lifecycle: **Receive → Store → Transfer/Issue → Ship Out**.

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo (SDK 54) |
| Navigation | Expo Router v6 (file-based) |
| Backend | Supabase (Postgres + Auth + Storage) |
| Forms | React Hook Form + Zod |
| State | Zustand |
| Offline | AsyncStorage write queue + read cache, NetInfo connectivity |
| QR Generation | qrcode (data URL), expo-print (HTML to PDF) |

## Directory Structure

```
app/                         — Expo Router screens (file-based routing)
  _layout.tsx                — Root Stack: index, (auth), (field), (office)
  index.tsx                  — Auth check → redirect to login or role-appropriate tabs
  (auth)/
    _layout.tsx              — Stack for auth screens
    login.tsx                — Email/password login
  (field)/
    _layout.tsx              — Tab navigator for field workers
    scan.tsx                 — QR scanner → on scan navigates to receiving wizard
    receiving.tsx            — 6-step receiving wizard (hidden from tab bar)
    inventory.tsx            — Browse materials with search/filter, tap for detail
    material-detail.tsx      — Material info + Transfer/Issue/Ship Out modals + shipment history (hidden from tab bar)
    activity.tsx             — Recent actions log (receiving, transfers, issues)
  (office)/
    _layout.tsx              — Tab navigator for office staff
    dashboard.tsx            — KPI cards and yard overview
    materials.tsx            — Material inventory and detail navigation
    exceptions.tsx           — Exception queue with Open/All filter, expand to review + resolve
    locations.tsx            — Zone/row/rack management
    qr-codes.tsx             — Batch QR generation, printable labels (PDF), QR detail view
    reports.tsx              — Aging, counts, CSV export

components/
  ui/                        — Reusable UI: Button, Card, Input, SignOutButton, OfflineIndicator, LoadingScreen, ErrorBoundary
  forms/                     — Wizard step components: MaterialStep, POStep, InspectionStep, PhotoStep, LocationStep, DecisionStep
  scanning/                  — QRScanner component (expo-camera barcode scanning + manual entry)

lib/
  supabase.ts                — Supabase client initialization
  api/receiving.ts           — QR lookup/create, photo upload, submit receiving record, auto-create material
  api/materials.ts           — Fetch materials, transfer between locations, issue to jobs
  api/exceptions.ts          — Fetch exception queue, resolve exceptions
  api/activity.ts            — Fetch recent activity (receivings, transfers, issues)
  api/shipments.ts           — Create shipment, fetch shipment history for a material
  api/dashboard.ts           — Dashboard KPIs, inventory by type, yard overview
  api/qrcodes.ts             — Batch create QR codes, fetch list, fetch detail with linked material
  api/auditLog.ts            — Log actions to audit_log table, fetch recent audit entries
  sync/networkStore.ts       — Zustand store tracking online/offline via NetInfo
  sync/offlineQueue.ts       — AsyncStorage-based write queue (add, remove, get, clear)
  sync/syncManager.ts        — Processes queue on reconnection, auto-syncs via network subscription
  sync/readCache.ts          — AsyncStorage read cache for offline browsing (30min TTL)
  utils/validation.ts        — Zod schemas for each wizard step
  utils/                     — Photo compression, formatters

stores/
  authStore.ts               — Auth state: user, session, signIn, signOut, loadSession
  receivingStore.ts          — Multi-step wizard state, persisted to AsyncStorage

types/
  database.ts                — TypeScript interfaces for all DB tables

constants/
  Colors.ts                  — Theme colors
  materialTypes.ts           — Material type, grade, size enums

supabase/
  README.md                  — Pointer: the shared database's migrations, seeds and
                               edge functions live in TomEnglish/invenio-tek-msr/supabase

eas.json                     — EAS Build profiles (development, preview, production)
```

## Auth Flow

1. App starts → `app/index.tsx` calls `loadSession()` from auth store
2. If no session → redirect to `/(auth)/login`
3. If session exists → fetch user profile from `users` table to get role
4. If `field_worker` → redirect to `/(field)/scan`
5. If `office_staff` or `admin` → redirect to `/(office)/dashboard`
6. Sign out button in tab headers clears session and redirects to login

## Data Model

### Phase 1 Tables
- **users** — linked to Supabase Auth via `id = auth.users.id`. Stores role.
- **locations** — zones, rows, racks in the laydown yard. `is_hold_area` flags exception storage.
- **qr_codes** — lookup table. `code_value` is what's encoded in the physical QR label. `entity_type` + `entity_id` link to the associated record.

### Phase 2 Tables
- **receiving_records** — full receiving inspection form data. Linked to qr_code and location.
- **inspection_photos** — photos uploaded during receiving. Stored in Supabase Storage, path saved here.

### Phase 4 Tables
- **materials** — created from accepted receiving_records. Tracks `current_quantity` as it decreases via issues/shipments.
- **material_movements** — audit trail for location transfers.
- **material_issues** — records material issued to job numbers.
- **shipments_out** — records material shipped off-site.

### Phase 9 Tables
- **audit_log** — tracks all significant actions (receiving, transfer, issue, shipment, exception resolution) with user, entity, and details JSON.

### Dashboard Views
- `v_inventory_summary` — counts and totals grouped by type and status
- `v_aging_report` — materials in yard with days_in_yard calculation
- `v_exception_summary` — unresolved exceptions with creator info
- `v_yard_overview` — location utilization (items stored vs capacity)

## RLS Policy Summary

| Table | Select | Insert | Update |
|---|---|---|---|
| users | Own profile / office+admin see all | — | — |
| locations | All authenticated | Office + admin | Office + admin |
| qr_codes | All authenticated | All authenticated | Office + admin |
| receiving_records | All authenticated | All authenticated | Office + admin |
| inspection_photos | All authenticated | All authenticated | — |
| materials | All authenticated | All authenticated | All authenticated |
| material_movements | All authenticated | All authenticated | — |
| material_issues | All authenticated | All authenticated | — |
| shipments_out | All authenticated | All authenticated | — |
| audit_log | All authenticated | All authenticated | — |

## Key Design Decisions

- **QR codes are lookup keys** — they encode a UUID, all meaning is in the DB
- **Role-based tab groups** — Expo Router renders different tab navigators per role
- **Zustand for state** — minimal boilerplate, persisted to AsyncStorage for form crash recovery
- **Supabase RLS** — database-level security enforcement, not just client-side
- **Photos compressed before upload** — resize to 1200px, JPEG 0.7 quality, <500KB target
- **Offline = write queue** — AsyncStorage-based, not full DB sync. Queues transfers, issues, shipments, and receiving records. Photos excluded from offline queue (require network). Auto-syncs when connectivity returns via NetInfo listener. Read cache provides offline browsing of materials/locations.

## Environment Variables

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Copy `.env.example` to `.env` and fill in your Supabase project credentials.

## Building

```bash
# Development (Expo Go)
npx expo start --tunnel --clear

# EAS Build — development client (includes native modules)
eas build --profile development --platform ios
eas build --profile development --platform android

# EAS Build — production
eas build --profile production --platform all
```

## Audit Logging

All significant actions are logged to the `audit_log` table:
- `receiving_created` — new receiving record submitted
- `material_transferred` — material moved between locations
- `material_issued` — material issued to a job
- `shipment_created` — material shipped out
- `exception_resolved` — exception marked as hold or returned

Each entry includes user_id, entity reference, and a details JSON blob with context.
