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

All 26 tests pass. `npm run lint` and `npx expo export --platform web` also pass;
the web login was verified in Chrome without console errors. Native camera,
force-close/restart and hosted email/storage behavior remain release smoke checks.
See the sibling MSR `docs/PLATFORM_RELEASE.md` for the coordinated release guide.
