// Where this build's office site lives. Each environment (dev, demo, a
// customer) has its own, set when the app is built or an update is published
// (EXPO_PUBLIC_OFFICE_SITE_URL). There is no built-in address: a build without
// one hides the office links rather than sending people to another
// environment's site. scripts/check-release-env.cjs refuses to publish that way.
const configured = (process.env.EXPO_PUBLIC_OFFICE_SITE_URL ?? '').trim().replace(/\/+$/, '');

function origin(value: string): string | null {
  const match = /^(https?):\/\/([a-z0-9.-]+)(:\d+)?$/i.exec(value);
  if (!match) return null;
  const local = match[2] === 'localhost' || match[2] === '127.0.0.1';
  return match[1].toLowerCase() === 'https' || local ? value : null;
}

export const officeSiteUrl: string | null = origin(configured);

/** The address of a page on this environment's office site, or null when none is set. */
export function officeSitePage(page: string): string | null {
  return officeSiteUrl ? `${officeSiteUrl}/${page.replace(/^\/+/, '')}` : null;
}
