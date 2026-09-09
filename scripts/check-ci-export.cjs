const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve('dist-ci/_expo/static/js/web');
let found = false;
for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(directory, name), 'utf8');
  const hosts = source.match(/https:\/\/[a-zA-Z0-9.-]+\.supabase\.co/g) || [];
  if (hosts.some(host => host !== 'https://example.supabase.co')) throw new Error('CI export contains a non-fixture Supabase backend. Clear Metro and rebuild with CI environment values.');
  if (hosts.includes('https://example.supabase.co') && source.includes('ci-build-placeholder')) found = true;
}
if (!found) throw new Error('Expected placeholder backend and key are missing from the CI bundle');
console.log('CI web export uses the placeholder backend and key.');
