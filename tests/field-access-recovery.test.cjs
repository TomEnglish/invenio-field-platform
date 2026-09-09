const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

const PROJECTS = [
  { id: 'project-a', name: 'Yard A', status: 'active' },
  { id: 'project-b', name: 'Yard B', status: 'active' },
];
const sessionFor = (id) => ({
  user: { id }, access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const records = new Map();
  const controls = {
    session: sessionFor('worker-a'), connection: 'online', inactive: false,
    revoked: false, queryFailure: false, failProjectWrite: false, failHydration: false,
  };
  const calls = { queries: [], scopes: [], signOut: 0 };
  const storage = {
    getItem: async (key) => records.get(key) ?? null,
    setItem: async (key, value) => {
      if (controls.beforeWrite) await controls.beforeWrite(key, value);
      if (controls.failProjectWrite && key.startsWith('active-project-')) throw new Error('Storage unavailable');
      records.set(key, value);
    },
    removeItem: async (key) => { records.delete(key); },
    getAllKeys: async () => [...records.keys()],
    multiRemove: async (keys) => { keys.forEach((key) => records.delete(key)); },
  };
  const read = async (table, userId) => {
    calls.queries.push({ table, userId });
    if (controls.beforeQuery) await controls.beforeQuery(table, userId);
    if (controls.connection !== 'online' || controls.queryFailure) throw new Error('Network request failed');
    if (controls.deniedTable === table) {
      controls.connection = 'offline';
      return { data: null, error: { code: '42501', message: 'Permission denied' }, status: 403 };
    }
    if (table === 'users') return { data: {
      id: userId, email: `${userId}@example.com`, role: 'field_worker',
      is_active: !controls.inactive, invitation_status: controls.revoked ? 'cancelled' : 'accepted',
    }, error: null };
    if (table === 'user_projects') return { data: PROJECTS.map((projects) => ({ projects })), error: null };
    throw new Error(`Unexpected table ${table}`);
  };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: controls.session }, error: null }),
      signInWithPassword: async () => ({ data: { session: controls.session }, error: null }),
      signOut: async () => { calls.signOut += 1; controls.session = null; return { error: null }; },
    },
    from: (table) => ({ select: () => ({ eq: (_field, userId) => ({
      single: () => read(table, userId),
      then: (resolve, reject) => read(table, userId).then(resolve, reject),
    }) }) }),
  };
  function restart() {
    const loader = createModuleLoader({ stubs: {
      zustand: require('zustand'),
      'zustand/middleware': require('zustand/middleware'),
      '@react-native-async-storage/async-storage': storage,
      '@/lib/supabase': { supabase },
      'stores/receivingStore.ts': { switchReceivingScope: async (userId, projectId) => {
        calls.scopes.push([userId, projectId]);
        if (controls.failHydration && userId) throw new Error('Draft hydration unavailable');
      } },
      '@react-native-community/netinfo': {
        fetch: async () => ({
          isConnected: controls.connection === 'unknown' ? null : controls.connection === 'online',
          isInternetReachable: controls.connection === 'unknown' ? null : controls.connection === 'online',
        }),
      },
      'lib/sync/networkStore.ts': { useNetworkStore: {
        getState: () => ({ isOnline: controls.connection === 'online' }),
        subscribe: () => () => {},
      } },
    } });
    return loader.load('./stores/authStore.ts').useAuthStore;
  }
  async function validateOnline() {
    const store = restart();
    await store.getState().loadSession();
    assert.equal(store.getState().user?.id, 'worker-a', 'The fixture must first establish real online access');
    return store;
  }
  return { records, controls, calls, restart, validateOnline };
}

test('offline restart restores the previously verified account, projects, and selected project without storing tokens', async () => {
  const h = harness();
  const original = await h.validateOnline();
  await original.getState().setActiveProject('project-b');
  h.controls.connection = 'offline';
  h.calls.queries.length = 0;
  const restarted = h.restart();
  await restarted.getState().loadSession();
  const state = restarted.getState();
  assert.equal(state.user?.id, 'worker-a');
  assert.equal(state.activeProject?.id, 'project-b');
  assert.equal(JSON.stringify(state.availableProjects.map((project) => project.id)), JSON.stringify(['project-a', 'project-b']));
  assert.equal(state.accessMode, 'offline');
  assert.equal(state.loading, false);
  assert.deepEqual(h.calls.scopes.at(-1), ['worker-a', 'project-b']);
  assert.equal(h.calls.queries.length, 0, 'Confirmed offline recovery must not depend on remote access queries');
  const persisted = JSON.stringify([...h.records.values()]);
  assert.doesNotMatch(persisted, /fixture-access-token|fixture-refresh-token/);
});

test('successful online validation reports online access mode', async () => {
  const store = await harness().validateOnline();
  assert.equal(store.getState().accessMode, 'online');
});

for (const deniedCase of ['another account', 'no session', 'expired session', 'unknown connection']) {
  test(`cached access is unavailable with ${deniedCase}`, async () => {
    const h = harness();
    await h.validateOnline();
    h.controls.connection = deniedCase === 'unknown connection' ? 'unknown' : 'offline';
    if (deniedCase === 'another account') h.controls.session = sessionFor('worker-b');
    if (deniedCase === 'no session') h.controls.session = null;
    if (deniedCase === 'expired session') h.controls.session.expires_at = Math.floor(Date.now() / 1000) - 60;
    const restarted = h.restart();
    await restarted.getState().loadSession();
    assert.equal(restarted.getState().user, null);
    assert.equal(restarted.getState().activeProject, null);
    assert.equal(restarted.getState().accessMode, null);
    assert.equal(restarted.getState().loading, false);
  });
}

for (const deniedCase of ['inactive', 'revoked']) {
  test(`online ${deniedCase} access removes eligibility for a later offline restart`, async () => {
    const h = harness();
    await h.validateOnline();
    h.controls[deniedCase] = true;
    const denied = h.restart();
    await denied.getState().loadSession();
    assert.equal(denied.getState().user, null);
    assert.equal(denied.getState().accessMode, null);
    h.controls.session = sessionFor('worker-a');
    h.controls.connection = 'offline';
    const offline = h.restart();
    await offline.getState().loadSession();
    assert.equal(offline.getState().user, null, 'An online rejection must invalidate the previously accepted snapshot');
    assert.equal(offline.getState().loading, false);
  });
}

test('explicit signout clears offline eligibility while preserving existing receiving drafts', async () => {
  const h = harness();
  const draftKey = 'receiving-wizard-worker-a-project-a';
  const draft = JSON.stringify({ state: { qrCodeValue: 'SAVED-DRAFT', operationId: 'original-operation' } });
  h.records.set(draftKey, draft);
  const store = await h.validateOnline();
  await store.getState().signOut();
  assert.equal(store.getState().user, null);
  assert.equal(store.getState().accessMode, null);
  assert.equal(h.records.get(draftKey), draft);
  assert.deepEqual(h.calls.scopes.at(-1), [null, null]);
  assert.equal(h.calls.signOut, 1);
  h.controls.session = sessionFor('worker-a'); // Even a stale SDK session must not revive explicit signout.
  h.controls.connection = 'offline';
  const restarted = h.restart();
  await restarted.getState().loadSession();
  assert.equal(restarted.getState().user, null);
  assert.equal(h.records.get(draftKey), draft);
});

test('unexpected access-query failure while online cannot grant cached access', async () => {
  const h = harness();
  await h.validateOnline();
  h.controls.queryFailure = true;
  const restarted = h.restart();
  await restarted.getState().loadSession();
  assert.equal(restarted.getState().user, null);
  assert.equal(restarted.getState().activeProject, null);
  assert.equal(restarted.getState().accessMode, null);
  assert.equal(restarted.getState().loading, false);
});

for (const failure of ['failProjectWrite', 'failHydration']) {
  test(`failed project switch (${failure}) releases loading without activating the failed project`, async () => {
    const h = harness();
    const store = await h.validateOnline();
    h.controls[failure] = true;
    await store.getState().setActiveProject('project-b').catch(() => {});
    assert.equal(store.getState().loading, false);
    assert.notEqual(store.getState().activeProject?.id, 'project-b');
  });
}

test('failed draft hydration during session restoration releases loading', async () => {
  const h = harness();
  await h.validateOnline();
  h.controls.failHydration = true;
  const restarted = h.restart();
  await restarted.getState().loadSession().catch(() => {});
  assert.equal(restarted.getState().loading, false);
  assert.equal(restarted.getState().user, null);
});

test('verification completing after signout cannot recreate offline eligibility', async () => {
  const h = harness();
  const store = await h.validateOnline();
  const entered = deferred(), release = deferred();
  h.controls.beforeQuery = async (table) => {
    if (table === 'user_projects') { entered.resolve(); await release.promise; }
  };
  const pending = store.getState().loadSession();
  await entered.promise;
  await store.getState().signOut();
  release.resolve();
  await pending;
  assert.equal(store.getState().user, null);
  h.controls.session = sessionFor('worker-a');
  h.controls.connection = 'offline';
  const restarted = h.restart();
  await restarted.getState().loadSession();
  assert.equal(restarted.getState().user, null, 'The obsolete verification must not revive an explicitly cleared snapshot');
});

test('project persistence completing after an account switch cannot hydrate the previous account draft', async () => {
  const h = harness();
  const store = await h.validateOnline();
  const entered = deferred(), release = deferred();
  h.controls.beforeWrite = async (key) => {
    if (key === 'active-project-worker-a') { entered.resolve(); await release.promise; }
  };
  const pending = store.getState().setActiveProject('project-b');
  await entered.promise;
  await store.getState().signOut();
  h.controls.session = sessionFor('worker-b');
  const result = await store.getState().signIn('worker-b@example.com', 'fixture-password');
  assert.equal(result.error, null);
  assert.deepEqual(h.calls.scopes.at(-1), ['worker-b', 'project-a']);
  release.resolve();
  await pending;
  assert.equal(store.getState().user?.id, 'worker-b');
  assert.deepEqual(h.calls.scopes.at(-1), ['worker-b', 'project-a'], 'A stale project selection must not replace the active account draft');
});

for (const table of ['users', 'user_projects']) {
  test(`explicit ${table} permission denial cannot fall back to cache if connectivity drops`, async () => {
    const h = harness();
    const store = await h.validateOnline();
    h.controls.deniedTable = table;
    await store.getState().loadSession();
    assert.equal(store.getState().user, null, 'A received server denial is authoritative even after a connectivity change');
    assert.equal(store.getState().accessMode, null);
    h.controls.session = sessionFor('worker-a');
    const restarted = h.restart();
    await restarted.getState().loadSession();
    assert.equal(restarted.getState().user, null, 'The denied snapshot must also be unavailable after restart');
  });
}
