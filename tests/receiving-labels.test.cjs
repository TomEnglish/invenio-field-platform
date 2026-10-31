const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The receiving steps and Review, rendered for real over one draft.
function setup(overrides = {}) {
  const draft = {
    operationId: 'op-1', step: 6, qrCodeValue: 'QR-1',
    material: { material_type: 'Pipe', qty: 4, size: '4"', grade: 'A106' },
    po: { po_number: 'PO-1042', vendor: 'Gulf Supply' },
    photos: [{ uri: 'file:///documents/receiving-photos/p1.jpg', photo_type: 'delivery_ticket' }],
    inspection: { condition: 'damaged', inspection_pass: true, damage_notes: 'Bent flange' },
    decision: { status: 'partially_accepted', accepted_qty: 2, has_exception: true, exception_type: 'wrong_count' },
    location: { location_id: 'rack-1' }, locationLabel: 'Zone A · Row 1, Rack 2',
    setMaterial() {}, setPO() {}, setInspection() {}, setDecision() {}, setLocation() {}, removePhoto() {},
    ...overrides,
  };
  const useReceivingStore = Object.assign(() => draft, { getState: () => draft });
  const rack = { id: 'rack-1', zone: 'Zone A', row: '1', rack: '2', is_hold_area: false };
  const select = () => ({ order: () => ({ order: () => ({ order: async () => ({ data: [rack], error: null }) }) }) });
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), zod: require('zod'),
    'react-native': {
      View: 'View', Text: 'Text', ScrollView: 'ScrollView', Image: 'Image', TouchableOpacity: 'TouchableOpacity', KeyboardAvoidingView: 'KeyboardAvoidingView',
      StyleSheet: { create: (styles) => styles }, Alert: { alert() {} }, Platform: { OS: 'ios' },
    },
    'expo-image-picker': {},
    '@/lib/utils/savePhotoToDraft': { savePhotoToDraft: async () => {} },
    '@/lib/supabaseProject': { getProjectClient: () => ({ from: () => ({ select }) }) },
    '@/stores/receivingStore': { useReceivingStore },
    '@/components/ui/Button': { Button: (props) => React.createElement('Button', props) },
    '@/components/ui/Input': { Input: (props) => React.createElement('Input', props) },
    '@/lib/design/tokens': { colors: new Proxy({}, { get: () => '#000' }) },
  } });
  return { loader, draft };
}
async function render(h, file, name, props = {}) {
  const Step = h.loader.load(file)[name];
  let r;
  await TestRenderer.act(async () => {
    r = TestRenderer.create(React.createElement(Step, { onNext() {}, onBack() {}, onEdit() {}, onSubmit() {}, submitting: false, ...props }));
    // The Location step lists racks once they load.
    await new Promise(resolve => setImmediate(resolve));
  });
  const texts = r.root.findAll(node => node.type === 'Text').map(node => [].concat(node.props.children).flat().join(''));
  const buttons = r.root.findAll(node => node.type === 'Button').map(node => node.props.title);
  await TestRenderer.act(async () => { r.unmount(); });
  return { texts, buttons };
}
const STEPS = [
  ['./components/forms/MaterialStep.tsx', 'MaterialStep'], ['./components/forms/POStep.tsx', 'POStep'], ['./components/forms/PhotoStep.tsx', 'PhotoStep'],
  ['./components/forms/InspectionStep.tsx', 'InspectionStep'], ['./components/forms/DecisionStep.tsx', 'DecisionStep'], ['./components/forms/LocationStep.tsx', 'LocationStep'],
];

test('known limits: each receiving page is titled as its step in the header, and Review names its sections the same', async () => {
  const h = setup();
  const { RECEIVING_STEPS } = h.loader.load('./lib/utils/receivingLabels.ts');
  assert.deepEqual([...RECEIVING_STEPS], ['Material details', 'PO / delivery', 'Photos', 'Inspection', 'Decision', 'Location', 'Review']);
  for (const [index, [file, name]] of STEPS.entries()) {
    const { texts } = await render(h, file, name);
    assert.equal(texts[0], RECEIVING_STEPS[index], `${name} is titled as step ${index + 1}`);
  }
  const review = await render(h, './components/forms/ReceivingReviewStep.tsx', 'ReceivingReviewStep');
  assert.equal(review.texts[0], 'Review');
  for (const title of RECEIVING_STEPS.slice(0, 6)) assert.ok(review.texts.includes(title), title);
  for (const old of ['Storage Location', 'Storage location', 'Material Details', 'PO / Delivery Info', 'PO & delivery', 'Review receiving']) {
    assert.equal(review.texts.includes(old), false, old);
  }
});

test('known limits: Review words the condition, decision, exception and photo type as their steps do', async () => {
  const h = setup();
  const inspection = await render(h, './components/forms/InspectionStep.tsx', 'InspectionStep');
  const decision = await render(h, './components/forms/DecisionStep.tsx', 'DecisionStep');
  const photo = await render(h, './components/forms/PhotoStep.tsx', 'PhotoStep');
  const review = await render(h, './components/forms/ReceivingReviewStep.tsx', 'ReceivingReviewStep');
  for (const [label, step] of [['Damaged', inspection.buttons], ['Partial Accept', decision.buttons], ['Wrong Count', decision.buttons], ['Delivery Ticket', photo.buttons]]) {
    assert.ok(step.includes(label), `the step offers ${label}`);
    assert.ok(review.texts.includes(label), `Review shows ${label}`);
  }
  assert.ok(photo.texts.includes('Delivery Ticket'), 'the photo on its step is labelled the same');
  for (const old of ['damaged', 'Partially accept', 'Quantity mismatch', 'delivery ticket', 'delivery_ticket']) assert.equal(review.texts.includes(old), false, old);

  const wrongType = setup({ decision: { status: 'accepted', has_exception: true, exception_type: 'wrong_type' }, inspection: { condition: 'good', inspection_pass: true } });
  const shown = await render(wrongType, './components/forms/ReceivingReviewStep.tsx', 'ReceivingReviewStep');
  assert.ok(shown.texts.includes('Wrong Type'));
  assert.ok(shown.texts.includes('Good'));
  assert.ok(shown.texts.includes('Accept'));
  assert.equal(shown.texts.includes('Wrong material'), false);
});

test('known limits: a problem on Review sends you back to the step by its name', async () => {
  const noRack = setup({ location: { location_id: '' }, locationLabel: '' });
  assert.ok((await render(noRack, './components/forms/ReceivingReviewStep.tsx', 'ReceivingReviewStep')).buttons.includes('Review location'));
  const noType = setup({ material: { material_type: '', qty: 4 } });
  assert.ok((await render(noType, './components/forms/ReceivingReviewStep.tsx', 'ReceivingReviewStep')).buttons.includes('Review material details'));
  // A draft restored with a bad PO field: the capitals of "PO" stay.
  const badPO = setup({ po: { po_number: 1042 } });
  assert.ok((await render(badPO, './components/forms/ReceivingReviewStep.tsx', 'ReceivingReviewStep')).buttons.includes('Review PO / delivery'));
});
