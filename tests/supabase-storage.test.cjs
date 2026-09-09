const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

test('server rendering initializes Supabase without touching browser-only AsyncStorage', async () => {
  let nativeStorageReads = 0;
  const storage = {
    getItem: async () => {
      nativeStorageReads++;
      throw new ReferenceError('window is not defined');
    },
    setItem: async () => { throw new ReferenceError('window is not defined'); },
    removeItem: async () => { throw new ReferenceError('window is not defined'); },
  };
  const { load } = createModuleLoader({ stubs: {
    '@react-native-async-storage/async-storage': storage,
    'react-native': { Platform: { OS: 'web' } },
    '@supabase/supabase-js': {
      createClient: (_url, _key, options) => ({
        // Auth initialization restores a persisted session before any UI renders.
        initialization: options.auth.persistSession && options.auth.storage
          ? options.auth.storage.getItem('test-auth-token')
          : Promise.resolve(null),
      }),
    },
  } });
  const { supabase } = load('./lib/supabase.ts');
  await assert.doesNotReject(supabase.initialization);
  assert.equal(nativeStorageReads, 0);
});

test('native clients still restore persisted sessions through AsyncStorage', async () => {
  let nativeStorageReads = 0;
  const { load } = createModuleLoader({
    globals: { navigator: { product: 'ReactNative' } },
    stubs: {
      '@react-native-async-storage/async-storage': {
        getItem: async () => { nativeStorageReads++; return 'saved-native-session'; },
        setItem: async () => {}, removeItem: async () => {},
      },
      'react-native': { Platform: { OS: 'ios' } },
      '@supabase/supabase-js': {
        createClient: (_url, _key, options) => ({
          initialization: options.auth.persistSession && options.auth.storage
            ? options.auth.storage.getItem('test-auth-token')
            : Promise.resolve(null),
        }),
      },
    },
  });
  const { supabase } = load('./lib/supabase.ts');
  assert.equal(await supabase.initialization, 'saved-native-session');
  assert.equal(nativeStorageReads, 1);
});
