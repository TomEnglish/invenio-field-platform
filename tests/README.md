# Field regression tests

Run from the Invenio Field directory:

```sh
node --test tests/*.test.cjs
```

The tests use Node's built-in test runner and the project's existing TypeScript
compiler, without an Expo runtime, network requests, or additional dependencies.
`helpers/load-typescript.cjs` evaluates real application modules and uses in-memory
storage/auth and business API fakes at the native/network boundaries.

Contracts covered:

- Offline actions capture the authenticated user and active project when created.
- Queue item IDs are UUIDs that remain stable across retries.
- Replay waits for the original context, checks it for each action, and preserves
  legacy unscoped work rather than guessing its project.
- Inventory cache entries cannot cross users or projects.
- Server initialization avoids browser-only storage; native authentication still
  restores persisted sessions.

- Receiving drafts preserve separate accounts/projects, photos and operation IDs across restart.
- Photo upload/reference failures propagate, and a context change during either asynchronous step stops subsequent writes.

Initial field inventory (Count tab, contract in MSR `docs/INITIAL_INVENTORY.md`):

- `inventory-helpers`: category tree, breadcrumb and whole-tree search; point-in-zone,
  smallest-zone wins; fit, zoom-about-finger, pan clamping and tap → pin maths;
  quantity rule; progress and outstanding lists; receiving pre-fill and banner text.
- `count-draft`: count drafts are scoped per account and project like receiving;
  "Count next" keeps category, plan view and zone; `switchFieldScopes` moves both drafts.
- `count-queue`: the `count` action calls `apply_field_operation` with the contract
  payload, uploads photos to `inventory-photos/<uid>/<operation>-<n>.jpg`, then
  `attach_inventory_photo`; failures retry the same operation; Sync wording.
- `count-review`: review validation sends the user to the step to fix; payload shape.
- `count-cache`: categories, plans, zones and tags are cached per account and project;
  tags are stored in chunks with an overlay for counts saved on the device; plan images
  are downloaded once per version; every page of a refresh comes from the project it
  started in; overlapping refreshes share one download.
- `count-begin`, `count-screen`, `count-receiving-handoff`: scan → count start rules,
  the Count screens, and Scan → receiving pre-filled from a count.
- `area-helpers`, `count-location-step`: nested map areas (migration 020): the area
  tree, retired branches hidden, path labels, search, the deepest area under a tap,
  zoom-to-area, the linked rack location; the Location step's list ↔ plan sync and the
  required area; a plan or area missing from the device's copy kept (not called
  retired) until a download made for it confirms it; the shown plan's chip choosing
  it; one tap announcement per platform; outline checks only under the finger.
- `count-reference-check`: the real reference hook downloads once for each new
  location to check, even with a saved copy; failed or offline checks stay unconfirmed.
- `site-map-picker`: the real plan component (gesture and SVG libraries faked):
  fit, zoom to a picked area, outline tiers, tap → area, and a fitted plan after
  switching plans and back.
- `count-sync-recovery`: a count the server refused can be reopened in Count (new
  operation ID, never over a count in progress, named so Count checks it against a
  fresh download before judging the location again) or discarded after a confirmation;
  received tags can only be discarded; photo and connection failures just retry.

Crates (logistics phase 1, contract in MSR migration 021):

- `crate-rules`: labels in any case; scanned items and crates checked against the
  device's copy as the server checks them (another crate, not counted or received,
  in itself, a loop, more than 5 levels, 500 tags), with tags it doesn't know added
  unchecked; review rules (no empty seal, an area to seal a crate on its own, no
  tag the server has refused, nothing taken out that has already left); the pack
  payload sending details and location only when they differ from the server's
  (a waiting pack's are sent again); saved packs, unpacks and counts laid over the
  copy, idempotently; fresh server rows (whole crate trees) replacing it.
- `crate-sync`: crates, places (shared and this project's, active), in-yard materials
  by tag and inventory records cached per account and project in chunks; a queued
  `pack` / `unpack` sent to `apply_field_operation` unchanged and shown before the next
  download, even when it lands mid-download; nothing written under another project;
  refusals recognised by the server's wording (not by words in a tag) and kept in
  Sync with its reason; refused changes left out of the device's picture; lookups.
- `crate-scan`: the scanner's repeat filter and continuous mode (live camera, tick,
  running count, manual entry); Scan sends `HU-` labels to the Crate screen with no
  lookup, and offers Pack a crate / Continue packing.
- `crate-screens`: the Pack flow from label (looked up online) to one queued pack under
  the draft's operation ID: the server asked before answering about refusals and
  unknown tags, accepted tags checked in the background and marked if refused, Save
  waiting for checks in flight; a draft already queued starts over; the pack draft kept
  per account and project and across restarts; the Crate screen from the device's copy,
  refused changes named, nested crates, packing, and unpacking (not while packing it).

Loads (logistics phase 2, contract in MSR migration 022):

- `load-rules`: check-in validation (driver, up to 3 companies, licence number shape,
  real expiry date, front photo unless a licence is on file) and its two payloads (the
  number never in the load_save); the load-out checklist ("N of M on board") at the
  origin and at a pick-up stop; scan checks (another load, inside a crate, packed,
  unpacked crates) and drop-off choices; unplanned pieces with their stop and undo; a
  load made offline taken all the way through by the overlay, idempotently; depart
  rules and what stays behind; unloading (due, wrong stop, extra, another load's piece,
  missing on finish); the editor's change-only payload; 022's crate rules.
- `load-sync`: every load operation queued and sent to `apply_field_operation`
  unchanged, with Sync summaries; the licence recorded first and the number dropped
  from the queue before any photo uploads, photos uploaded without upsert, "already
  exists" taken as landed on a retry, files deleted after sync and the number in no
  local store; refusals by the server's wording; loads cached (open and recent) with
  stops, lines and companies; an item's current load; a database without 022.
- `load-screens`: load out (ticks, the drop-off question, take off, batched saves, an
  unknown piece on its own), check-in (two queued items, the number never written to the
  draft or shown back), depart and unload (area only at our own place, Finish stop's
  warning, scans saved first).
- Review fixes, in the same files: step screens start fresh on each visit (editor, check-in,
  depart, unload); a load's later steps wait when an earlier one fails; stop dates kept;
  check-in sends only what changed; unknown codes unload on their own; a finished stop takes
  no more pieces; Finish stop and Done wait for every scan to save; one undo per piece; the
  server's newer line wins for an item; 022's columns tried again on each download; a stuck
  licence can be discarded; licence photos leave no other copy.

- The user's rules and the second review (D8, D9, E6, F1): refusals by SQLSTATE (22023 waits
  for a decision, isn't counted as a try or retried by itself, and drops out of the overlays);
  a load's steps strictly in order behind an unresolved one, with Depart and Finish stop blocked
  until it's sorted; the licence before departure; no Finish stop at shops and vendors; no area
  for a crate at an outside place; licence details in memory only (a restart means re-entering),
  photos as temporary files, a licence queued ahead of its load's departure, and every licence
  item, file and detail cleared at sign-out.

- The reworked 022 contract (`contract-022`, `packed-note`, and new cases in `load-sync`,
  `load-screens`, `count-begin`, `count-receiving-handoff` and `sync-screen`): the office's
  licence override (Depart, and from Sync after a refusal); who changes stops (the office's
  loads, a crew's own, only stops not yet reached after leaving); moving a piece from another
  load's plan; late unloading at a finished stop or after delivery, and corrections; partial
  batches whose turned-down pieces wait as their own steps; 42501 as a decision; written-off
  pieces refused; crate moves and item relocations; capturedAt on every step; tags whatever
  their capitals; lookup_tag deciding Scan and Count; item_positions for where an item is;
  the material page's rules; activity from list_project_activity.

Known limits from the field guide (MSR `docs/booklet`, appendix A10), fixed: the tests named
"known limits" in `count-screen`, `count-queue`, `count-cache`, `count-sync-recovery`,
`load-screens`, `queue-presentation`, `sync-screen`, `materials-search` and `receiving-labels`:

- A refused count shows "Needs attention in Sync" on Count home and isn't counted as found,
  also while Count home is showing: the server's refusal (22023 or 42501), a discard and Fix in
  Count each take the count out of the device's copy, unless the count may already be saved.
- The header banner counts refusals ("refused: open Sync to decide") apart from failed retries.
- Unload lists the areas of the site plans at the stop's place only (`plansAt`), and says when
  that place has no plan on the device.
- Inventory search matches QR codes as well as type and grade, with what was typed kept as text.
- Receiving's steps and Review share one set of words (`lib/utils/receivingLabels.ts`).
- Sync offers no retry for a licence that can only be recorded again, calls each item by one
  name on its Discard button and in the confirmation, lets anything retries gave up on be
  discarded, and says when a discard drops only the photos.

All tests pass (272 with the known-limit fixes). `npm run lint` and `npx expo export --platform web` also pass;
the web login was verified in Chrome without console errors. Native camera,
force-close/restart and hosted email/storage behavior remain release smoke checks.
See the sibling MSR `docs/PLATFORM_RELEASE.md` for the coordinated release guide.
