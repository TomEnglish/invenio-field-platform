# Field recovery review — September 9, 2026

Phase 4 follows the MSR dashboard and release-automation work. Implementation uses an isolated checkout; existing icon, layout and build-profile edits in the working project are preserved.

## Changes and verified behavior

- A previously verified user with a matching, unexpired persisted Supabase session can restore local access and the selected project when NetInfo confirms the device is offline. The snapshot stores profile/project data, never access or refresh tokens. Unknown connectivity, missing/expired sessions, another account, and an online access-query failure do not unlock cached access. Explicit authorization denials invalidate the snapshot even if connectivity drops afterward.
- Offline recovery is for local drafts, cached data and queued submissions. Queue replay and direct mutations require online access mode. Reconnection revalidates profile and memberships before upload. Existing server-side RLS and transactional operation checks remain authoritative. An online sign-in after this update is needed to create the first offline snapshot.
- Session revision checks prevent an older verification from recreating offline eligibility after signout and prevent an older project-selection request from loading another account's draft. SDK signout events also invalidate in-flight requests. Failed project persistence/hydration releases the loading state; corrupt draft bytes remain intact and recovery failure is explicit.
- Sync starts when identity/network are already ready, drains work added during an active run, and makes concurrent callers await completion. Connectivity loss and context changes do not consume retries. Completed projects wait without sending. Unknown legacy operation types remain visible for recovery. Stable server operation IDs continue preventing duplicate business mutations and photo references.
- Photo capture handles permission/picker errors, blocks duplicate capture and navigation while saving, and checks the original draft identity before attaching a persisted photo. A photo finishing after an account/project/receipt change cannot enter the new draft.
- Sync counts update when queue persistence changes. Sync & recovery shows the running update ID, runtime, channel and version so a published update can be compared with the actual device.

## Acceptance evidence

52 Node test entries pass locally, including independently authored failed-before tests for access recovery, signout/project races and authorization denial; real store persistence tests; reconnect/concurrent sync cases; and photo context boundaries. TypeScript and design-token lint pass. All-platform Expo exports are checked separately from device execution. MSR's real PostgreSQL suite verifies duplicate prevention and permissions on the shared backend.

`tests/browser/serve.py` serves the compiled CI-placeholder web export against a local fixture. Sign in as `field@example.test` with a nonempty fixture password. Fixture writes are disabled. It refuses bundles containing a real Supabase destination. Browser tests must not be pointed at production credentials or source records.

Metro may reuse transformed modules across local export environments. Use `--clear` when exporting; CI verifies that its web bundle contains only the placeholder Supabase backend/key. Use `eas update --clear-cache` for a production release, and never publish `dist-ci`.

## Physical-device acceptance still required

The Mac lists `EE Iphone` (iPhone14,5) as unavailable. No actual iPhone update uptake, camera capture, airplane-mode force-close/reopen or hardware reconnect test has been claimed.

1. Open the installed application online, sign in and open Sync & recovery. Compare its running update ID and runtime with the released EAS update for that platform.
2. In a designated test project, begin receiving, capture a general photo and delivery-ticket photo, then disable network access. Save a draft, force-close and reopen before the session expires; verify the draft, selected project and photos restore.
3. Submit offline, force-close and reopen again; verify the same submission ID remains. Restore connectivity and verify one receiving record with the expected photos, no duplicate material movement, and an empty queue.
4. Interrupt an upload, switch project/account, then return to the original context. Verify no work is attributed to the other account/project and retry completes once. Confirm the queue status refreshes without leaving the screen.
5. Test camera denial, unavailable photo files and real device storage failure without clearing app storage. Record any observed issue before broader rollout changes.

For expired offline sessions, reconnect to refresh or sign in; saved drafts/queue/photos remain on the device. Native camera permissions and file durability remain hardware acceptance items. No native dependencies or runtime version change is introduced by these fixes.

References: [NetInfo connectivity fields](https://github.com/react-native-netinfo/react-native-netinfo), [Expo SDK 54 running update identifiers](https://docs.expo.dev/versions/v54.0.0/sdk/updates/), [EAS runtime compatibility](https://docs.expo.dev/eas-update/runtime-versions/).
