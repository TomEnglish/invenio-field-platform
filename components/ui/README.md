# Invenio UI primitives

Component library for the Invenio Expo app. Every primitive:

- Imports tokens from `@/lib/design/tokens` (no raw hex — enforced by `npm run tokens:lint`)
- Meets the 44×44 touch-target minimum (WCAG 2.5.5 AAA)
- Carries correct `accessibilityRole` / `accessibilityState` / `accessibilityLabel`
- Accepts a `style` override for parent layout

For the rendered visual showcase, see `docs/prototype.html` (deployed at <https://invenioinvapp.netlify.app/prototype.html>).

## Quick import

```tsx
import {
  Button, Input, Checkbox, Radio, RadioGroup, Switch,
  Select, MultiSelect, DatePicker, DateRangePicker,
  ImagePicker, Modal, Toast, Card, DataTable,
  LoadingScreen, AppErrorBoundary, OfflineIndicator,
  ProjectSelector, SignOutButton,
} from '@/components/ui';
```

For dark-mode-aware screens, also pull from `@/lib/design/useTokens`:

```tsx
import { useTokens, useThemedStyles } from '@/lib/design/useTokens';
```

---

## Form primitives

### `Button`
```tsx
<Button title="Save" variant="primary" loading={saving} onPress={save} />
```
Variants: `primary` (default) · `secondary` (tonal sky) · `ghost` · `danger`. 44px min tap target. Web `:focus-visible` ring.

### `Input`
```tsx
<Input
  label="Email"
  value={email}
  onChangeText={setEmail}
  required
  error={errors.email}
  helper="We'll send shipment updates here."
/>
```
Props: `label`, `error`, `helper`, `required`. Focused border switches to brand-primary; error state borders red and announces via `accessibilityLiveRegion`.

### `Checkbox`
```tsx
<Checkbox checked={agreed} onChange={setAgreed} label="I agree" />
```

### `Radio` + `RadioGroup<T>`
```tsx
<RadioGroup
  value={density}
  onChange={setDensity}
  options={[
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact',     label: 'Compact' },
  ]}
/>
```
`Radio` is the single-button building block; `RadioGroup` is the common case.

### `Switch`
```tsx
<Switch value={smsAlerts} onChange={setSmsAlerts} label="SMS when shipment arrives" />
```
Wraps RN `Switch` with tokenized track/thumb. Inline label layout when `label` is set.

### `Select<T>`
```tsx
<Select
  label="Active project"
  value={projectId}
  onChange={setProjectId}
  options={projects.map(p => ({ value: p.id, label: p.name }))}
  searchable        // for lists 20+ items
/>
```
Generic over the value type (`string | number`). `searchable` adds typeahead.

### `MultiSelect<T>`
```tsx
<MultiSelect
  label="Material types"
  values={selectedTypes}
  onChange={setSelectedTypes}
  options={types}
  maxDisplay={2}    // collapse to "+N more" after this many selections
/>
```
Draft-then-Apply pattern — selections don't commit until the user taps Apply. Includes Select all / Clear bulk actions.

### `DatePicker` + `DateRangePicker`
```tsx
<DatePicker
  label="Ship date"
  value={shipDate}
  onChange={setShipDate}
  mode="date"          // 'date' | 'time' | 'datetime'
  minimumDate={today}
/>

<DateRangePicker
  label="Audit window"
  value={range}                 // { start: Date | null; end: Date | null }
  onChange={setRange}
/>
```
Wraps `@react-native-community/datetimepicker`. iOS uses an inline spinner inside a Modal with Apply/Cancel; Android opens the native dialog and commits on selection; web uses HTML5 `<input type="date">`.

### `ImagePicker`
```tsx
<ImagePicker
  value={photo}
  onChange={setPhoto}
  source="both"     // 'camera' | 'library' | 'both'
  label="Damage evidence"
  required
/>
```
Wraps `expo-image-picker`. `source="both"` prompts an Action sheet ("Camera" or "Photo library"). Handles permission requests; surfaces a one-line permission error inline. Empty state is a tappable dropzone; populated state shows a 4:3 preview with Replace / Remove buttons.

For multi-image, hold a `PickedImage[]` in the parent and render N pickers + an Add button.

---

## Feedback

### `Modal`
```tsx
<Modal
  visible={open}
  onClose={() => setOpen(false)}
  title="Delete PO?"
  actions={
    <>
      <Button title="Cancel" variant="ghost" onPress={cancel} />
      <Button title="Delete" variant="danger" onPress={confirm} />
    </>
  }
>
  <Text>This permanently removes 12 line items.</Text>
</Modal>
```
Tokenized backdrop + dialog around RN `<Modal>`. `dismissOnBackdrop={false}` to require explicit dismissal for destructive flows.

### `Toast`
```tsx
<Toast
  visible={saved}
  tone="success"          // 'success' | 'info' | 'warn' | 'danger'
  title="PO-99214 saved"
  message="All 12 line items recorded."
  onDismiss={() => setSaved(false)}
  autoDismissMs={4000}
/>
```
Status tones (success, info) → polite live region. Alert tones (warn, danger) → `role="alert"` + assertive live region. RN does not expose a `"status"` role; this is the closest correct mapping.

### `LoadingScreen`
Full-screen spinner with `accessibilityRole="progressbar"`. Use for top-level route transitions; use `<ActivityIndicator>` directly for inline loaders.

### `AppErrorBoundary`
React class boundary that renders a recoverable error screen with a "Try Again" button. Wrap your root `Stack` in `app/_layout.tsx`.

### `OfflineIndicator`
Banner that surfaces network state from `@/lib/sync/networkStore` and queue stats from `@/lib/sync/offlineQueue`. Three modes: offline, syncing N pending, dead-letter retry-failed.

---

### `EnvironmentLabel`
Shows the environment's label ("Dev"), and no other words, on a build for a dev environment (`environmentLabel` in `lib/config.ts`) and renders nothing in a production build, so it can sit on any screen. `variant="strip"` (default) is a full-width bar; `variant="pill"` is a small tag for a heading. `OfflineIndicator` leads with the strip, which puts it above every screen in the two tab layouts; the sign-in, access-pending and Sync & recovery screens carry the pill. A new screen outside the tab layouts must carry it too (`tests/environment-label.test.cjs` fails otherwise). Its purple is used by no other banner.

## Layout & data

### `Card`
```tsx
<Card onPress={openDetail}>
  <Text>...</Text>
</Card>
```
White surface, 12px radius, 1px border, subtle shadow, 16px padding.

### `DataTable<T>`
```tsx
<DataTable
  columns={[
    { key: 'po', header: 'PO', width: 120, sortable: true },
    { key: 'description', header: 'Description', sortable: true },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: row => <Tag tone="success">{row.status}</Tag>,
    },
    { key: 'value', header: 'Value', align: 'right',
      render: row => <Text>${row.value.toLocaleString()}</Text> },
  ]}
  data={rows}
  rowKey={r => r.po}
  sortBy={{ key: 'po', dir: 'asc' }}
  onSort={(key, dir) => setSort({ key, dir })}
  filters={[
    { label: 'All',       value: '' },
    { label: 'Delivered', value: 'Delivered' },
    { label: 'In transit', value: 'In transit' },
  ]}
  activeFilter={filter}
  onFilterChange={setFilter}
  pagination={{ page, pageSize: 25, total, onPageChange: setPage }}
  loading={isLoading}
  skeletonRows={5}
  emptyState={{ title: 'No POs match', caption: 'Try clearing the filter.' }}
  onRowPress={navigateToDetail}
/>
```

Every axis is **controlled** — you hold sort/filter/page state and DataTable reports user intent via callbacks. Wires cleanly to Supabase + TanStack Query (memoize the slice per page or do server-side pagination).

For a live demo of every state (sort, filter, sticky header, skeleton, empty), see `docs/prototype.html` Section 08.

---

## Project chrome

### `ProjectSelector`
Header pill that opens a Modal sheet of available projects when the user belongs to more than one. Reads/writes `useAuthStore`.

### `SignOutButton`
Right-side header icon. Confirms via `Alert.alert` before signing out and routing to `/(auth)/login`.

---

## Theming

`useTokens()` and `useThemedStyles()` from `@/lib/design/useTokens` provide dark-mode-aware token access. See `app/(office)/dashboard.tsx` for the canonical migration pattern.

```tsx
import { useTokens, useThemedStyles } from '@/lib/design/useTokens';

function MyScreen() {
  const c = useTokens();
  const styles = useThemedStyles((c) => ({
    container: { backgroundColor: c.canvas },
    title: { color: c.textPrimary },
  }));
  return (
    <View style={styles.container}>
      <FontAwesome name="x" color={c.brandPrimary} />
      <Text style={styles.title}>Hello</Text>
    </View>
  );
}
```

---

## Adding a new primitive

1. Drop it under `components/ui/<Name>.tsx`.
2. Import only from `@/lib/design/tokens` and `react-native` (and FontAwesome for icons).
3. Hit `npm run lint` — the `tokens:lint` script will fail if you ship a raw hex.
4. Add an export line to `components/ui/index.ts`.
5. Add a section to this README — props, example, a11y notes.
6. Bump the changelog (`CHANGELOG.md`) under the next minor version.

For a live HTML rendering, also add the primitive to `docs/prototype.html` so the design system page stays in sync with the RN library.
