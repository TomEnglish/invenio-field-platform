# Field UI workflow sprint — September 9, 2026

## Receiving

The receiving wizard has seven named steps, ending in a review of material, PO/delivery, photos, inspection, decision, and storage location. Each section can be edited and returned to review. Photo edits take effect as photos are added/removed; other step edits are kept by continuing. Empty optional details are omitted to reduce scrolling.

Final validation reruns before queue persistence. Changes to delivered quantity cannot bypass partial-acceptance limits, and inspection changes must be reconciled with the exception decision. Storage location choices are scoped to the active project; the selected location's display label travels with the local draft. Older drafts can retain their existing location if the lookup is unavailable.

Submission first awaits queue persistence and only clears the matching account/project/operation draft. Failed device storage leaves review available for retry. Saved and synced are separate outcomes: confirmation says synced only after the operation disappears from the completed upload queue.

## Sync

Pending receipts display material, PO, quantity and vendor. Status and recovery instructions distinguish saved work, interrupted uploads and submissions needing attention. Submission IDs, raw errors and app/update version are available through support disclosures.

Queue reads use a request generation and account/project checks so a late stale snapshot cannot restore an already uploaded item. Read failures do not report an empty queue. Existing retry and access validation remain in place.

## Verification

- 61 Node tests pass, including actual ReceivingScreenContent + offlineQueue with an AsyncStorage write rejection, retry success, and actual SyncScreen with out-of-order queue reads.
- Typecheck and design-token lint pass; iOS, Android and web export succeeds with CI placeholder backend configuration.
- Local browser fixture: complete seven-step flow; edit delivered quantity 10 to 4 with previous accepted quantity 5 blocks submission; corrected decision queues successfully; intentionally denied fixture upload keeps saved work and shows recovery context. Support details expand and keyboard navigation works. Phone layout checked at 390px.
- No production receipt, user, email or project data was changed during UI validation.
- Physical camera, native screen-reader and force-close/reconnect acceptance requires an available iPhone. Browser/export verification does not substitute for device acceptance.

## Release and rollback

Production uses the existing EAS project/channel and runtime 1.0.0. This sprint changes no database schema or native dependency. The prior production update group is `21db04a8-c496-42d2-aea2-741c737724e1`; it can be republished if a critical workflow regression appears. Keep queued submissions and draft storage intact during any rollback.

The original Field checkout's ten pending design/config changes are excluded and preserved. Source review: React Native accessibility documentation and the existing project design tokens/components.
