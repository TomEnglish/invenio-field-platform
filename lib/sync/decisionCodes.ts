// Codes that mean "refused, needs a decision": the server's 22023 (and 42501,
// a step this user isn't allowed, such as office-only ones), and the app's own
// for a licence whose number or photos are no longer on the device, or whose
// photo storage refused.
export const DECISION_CODES = new Set(['22023', '42501', 'LICENCE_FORGOTTEN', 'PHOTO_GONE', 'PHOTO_REFUSED']);
