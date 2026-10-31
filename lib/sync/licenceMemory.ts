// The licence details typed at check-in, kept in memory only: never written
// to storage, so closing the app or signing out forgets them. The queued
// licence item holds just the load and the photo files until it uploads.
export interface LicenceDetails { number: string; state?: string; expiry?: string }
const remembered = new Map<string, LicenceDetails>();
export const rememberLicence = (id: string, details: LicenceDetails) => { remembered.set(id, details); };
export const recallLicence = (id: string) => remembered.get(id);
export const forgetLicence = (id: string) => { remembered.delete(id); };
export const forgetLicences = () => { remembered.clear(); };
export const licenceKnown = (id: string) => remembered.has(id);
