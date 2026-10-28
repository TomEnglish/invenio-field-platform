const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The real useCountReference: a saved copy is used as it is, except that each
// new `check` (a location the copy can't answer, or a count reopened from
// Sync) is asked of the server once.
function setup({ online = true, fails = false } = {}) {
  const auth = { user: { id: 'worker-a' }, activeProject: { id: 'project-a' } };
  const saved = { categories: [], maps: [{ id: 'map-a' }], zones: [], items: [], images: {}, savedAt: '2026-10-28T08:00:00Z' };
  const fresh = { ...saved, maps: [{ id: 'map-b' }], savedAt: '2026-10-28T09:00:00Z' };
  const calls = { downloads: 0 };
  const loader = createModuleLoader({ stubs: {
    react: React,
    'expo-router': { useFocusEffect: (effect) => React.useEffect(effect, [effect]) },
    '@/stores/authStore': { useAuthStore: Object.assign((select) => select(auth), { getState: () => auth }) },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => ({ isOnline: online }) } },
    '@/lib/api/inventory': {
      EMPTY_REFERENCE: { categories: [], maps: [], zones: [], items: [], images: {}, savedAt: null },
      readCachedReference: async () => saved,
      loadCountReference: async () => {
        calls.downloads += 1;
        return fails ? { data: saved, source: 'cache', error: 'Network request failed' } : { data: fresh, source: 'online' };
      },
    },
  } });
  const { useCountReference } = loader.load('./components/inventory/useCountReference.ts');
  let latest;
  const Probe = ({ check }) => { latest = useCountReference({ refresh: false, check }); return null; };
  let renderer;
  const show = async (check) => {
    await TestRenderer.act(async () => {
      if (renderer) renderer.update(React.createElement(Probe, { check }));
      else renderer = TestRenderer.create(React.createElement(Probe, { check }));
    });
    return latest;
  };
  return { show, calls, unmount: () => TestRenderer.act(async () => { renderer.unmount(); }) };
}

test('a saved copy is used as it is until there is something to check, then each check downloads once', async () => {
  const h = setup();
  let result = await h.show(null);
  assert.equal(h.calls.downloads, 0, 'Count item uses the saved copy');
  assert.equal(result.data.maps[0].id, 'map-a');

  result = await h.show('map-a|zone-b');
  assert.equal(h.calls.downloads, 1, 'downloads even though a copy is saved');
  assert.equal(result.checked, 'map-a|zone-b');
  assert.equal(result.data.maps[0].id, 'map-b', 'the fresh copy is shown');

  await h.show('map-a|zone-b');
  assert.equal(h.calls.downloads, 1, 'not again for the same location');
  result = await h.show('map-new|');
  assert.equal(h.calls.downloads, 2);
  assert.equal(result.checked, 'map-new|');
  await h.unmount();
});

test('a failed or offline check is not marked as checked', async () => {
  const failing = setup({ fails: true });
  let result = await failing.show('map-a|zone-b');
  assert.equal(failing.calls.downloads, 1);
  assert.equal(result.checked, null, 'still unconfirmed: the copy may be out of date');
  assert.equal(result.error, 'Network request failed');
  await failing.unmount();

  const offline = setup({ online: false });
  result = await offline.show('map-a|zone-b');
  assert.equal(offline.calls.downloads, 0);
  assert.equal(result.checked, null);
  await offline.unmount();
});
