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
  required area.
- `count-sync-recovery`: a count the server refused can be reopened in Count (new
  operation ID, never over a count in progress) or discarded after a confirmation;
  received tags can only be discarded; photo and connection failures just retry.

All tests pass (137 with nested map areas). `npm run lint` and `npx expo export --platform web` also pass;
the web login was verified in Chrome without console errors. Native camera,
force-close/restart and hosted email/storage behavior remain release smoke checks.
See the sibling MSR `docs/PLATFORM_RELEASE.md` for the coordinated release guide.
