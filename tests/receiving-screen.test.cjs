const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('a failed queue save keeps the receiving draft and can be retried', async () => {
  const draft = {
    operationId: 'e2222222-2222-4222-8222-222222222222',
    step: 6,
    qrCodeValue: 'QR-RETRY',
    material: { material_type: 'Steel Pipe', qty: 4 },
    po: { po_number: 'PO-1042' },
    photos: [],
    inspection: { condition: 'good', inspection_pass: true },
    decision: { status: 'accepted', has_exception: false },
    location: { location_id: 'yard-a' },
    locationLabel: 'A · Row 1, Rack 2',
    setStep(step) { this.step = step; },
    reset() { resetCount += 1; this.step = 0; },
  };
  let resetCount = 0;
  let saveAttempts = 0;
  let queueBytes = null;
  const auth = {
    user: { id: 'worker-a' },
    session: { access_token: 'fixture-only' },
    activeProject: { id: 'project-a', status: 'active' },
    loading: false,
  };
  const useReceivingStore = Object.assign(() => draft, { getState: () => draft });
  const useAuthStore = Object.assign(() => auth, { getState: () => auth });
  const ReviewStep = (props) => React.createElement('ReviewStep', props);
  const EmptyStep = () => React.createElement('Step');
  const loader = createModuleLoader({ stubs: {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    zod: require('zod'),
    'react-native': {
      View: 'View', Text: 'Text', ScrollView: 'ScrollView',
      StyleSheet: { create: (styles) => styles },
    },
    'expo-router': {
      router: { replace() {}, back() {} },
      Stack: { Screen: () => React.createElement('StackScreen') },
    },
    '@/stores/receivingStore': { useReceivingStore },
    '@/stores/authStore': { useAuthStore },
    '@/lib/sync/networkStore': { useNetworkStore: { getState: () => ({ isOnline: false }) } },
    '@react-native-async-storage/async-storage': {
      getItem: async () => queueBytes,
      setItem: async (key, bytes) => {
        saveAttempts += 1;
        if (saveAttempts === 1) throw new Error('Storage unavailable');
        queueBytes = bytes;
      },
    },
    '@/lib/sync/syncManager': { processQueue: async () => ({ processed: 0, failed: 0 }) },
    '@/components/forms/MaterialStep': { MaterialStep: EmptyStep },
    '@/components/forms/POStep': { POStep: EmptyStep },
    '@/components/forms/InspectionStep': { InspectionStep: EmptyStep },
    '@/components/forms/PhotoStep': { PhotoStep: EmptyStep },
    '@/components/forms/LocationStep': { LocationStep: EmptyStep },
    '@/components/forms/DecisionStep': { DecisionStep: EmptyStep },
    '@/components/forms/ReceivingReviewStep': { ReceivingReviewStep: ReviewStep },
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }) },
  } });
  const { ReceivingScreenContent } = loader.load('./components/screens/ReceivingScreen.tsx');

  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(ReceivingScreenContent)); });
  await TestRenderer.act(async () => { await renderer.root.findByType('ReviewStep').props.onSubmit(); });

  assert.equal(resetCount, 0, 'the in-memory draft must not reset when queue persistence fails');
  assert.equal(draft.step, 6, 'the review remains available after the failed save');
  assert.match(renderer.root.findByType('ReviewStep').props.error, /Could not save: Storage unavailable/);
  assert.equal(renderer.root.findAllByProps({ children: 'Receiving saved' }).length, 0);

  await TestRenderer.act(async () => { await renderer.root.findByType('ReviewStep').props.onSubmit(); });
  assert.equal(saveAttempts, 2, 'the same submission can be retried');
  assert.equal(resetCount, 1, 'the draft resets only after queue persistence succeeds');
  assert.equal(JSON.parse(queueBytes)[0].id, draft.operationId);
  assert.equal(renderer.root.findAllByProps({ children: 'Receiving saved' }).length > 0, true);
  await TestRenderer.act(async () => { renderer.unmount(); });
});
