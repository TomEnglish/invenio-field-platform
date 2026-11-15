const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve('dist-ci/_expo/static/js/web');
let backend = false, office = false;
for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(directory, name), 'utf8');
  const hosts = source.match(/https:\/\/[a-zA-Z0-9.-]+\.supabase\.co/g) || [];
  if (hosts.some(host => host !== 'https://example.supabase.co')) throw new Error('CI export contains a non-fixture Supabase backend. Clear Metro and rebuild with CI environment values.');
  if (hosts.includes('https://example.supabase.co') && source.includes('ci-build-placeholder')) backend = true;
  // The office site is a build setting too; a real environment's address must never be bundled in CI.
  if (/https:\/\/[a-zA-Z0-9.-]+\/(login|projects)\.html/.test(source)) throw new Error('CI export contains a hard-wired office site page. The address must come from EXPO_PUBLIC_OFFICE_SITE_URL.');
  if (source.includes('https://office.example.com')) office = true;
}
if (!backend) throw new Error('Expected placeholder backend and key are missing from the CI bundle');
if (!office) throw new Error('Expected placeholder office site is missing from the CI bundle');
console.log('CI web export uses the placeholder backend, key and office site.');
