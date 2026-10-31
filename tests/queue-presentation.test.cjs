const test=require('node:test'),assert=require('node:assert/strict');
const {createModuleLoader}=require('./helpers/load-typescript.cjs');
const {queueSummary,queueRecoveryMessage}=createModuleLoader().load('./lib/sync/queuePresentation.ts');
test('receiving queue uses material and PO without repeating the prefix',()=>{const value=queueSummary({action:{type:'receiving',payload:{material:{material_type:'Pipe',qty:5},po:{po_number:'PO-123',vendor:'Supply'}}}});assert.equal(value.title,'Pipe');assert.equal(value.detail,'Receiving · PO-123 · 5 delivered · Supply');});
test('legacy submissions remain readable without missing payload errors',()=>{assert.equal(queueSummary({action:{type:'receiving'}}).title,'Receiving');assert.equal(queueSummary({action:{type:'unknown'}}).title,'Saved submission');});
test('photo and access failures provide distinct recovery instructions',()=>{assert.match(queueRecoveryMessage({lastError:'Receipt saved; photo upload will retry'}),/same submission/);assert.match(queueRecoveryMessage({lastError:'Access denied'}),/sign-in/);assert.match(queueRecoveryMessage({deadLetter:true}),/Automatic retries have stopped/);});

const { canDiscard, recordLicenceAgain, discardKeepsSaved } = createModuleLoader().load('./lib/sync/queuePresentation.ts');
const queued = (type, extra = {}, payload = {}) => ({ action: { type, payload }, retryCount: 0, deadLetter: false, ...extra });
test('known limits: anything automatic retries gave up on can be discarded, not only crates, loads and licences', () => {
  const dead = { retryCount: 5, deadLetter: true, lastError: 'Network request failed' };
  for (const type of ['receiving', 'transfer', 'issue', 'shipment', 'count', 'pack', 'load_on', 'licence']) assert.equal(canDiscard(queued(type, dead)), true, type);
  assert.equal(canDiscard(queued('transfer', { retryCount: 2, lastError: 'Network request failed' })), false, 'still retrying by itself');
  assert.equal(canDiscard(queued('receiving', { refused: true, lastErrorCode: '22023', lastError: 'Material is unavailable' })), true);
  assert.equal(canDiscard(queued('receiving')), false);
});
test('known limits: only recording a licence again helps when its number or photos are gone or the server turned it down', () => {
  const licence = (code, lastError, extra = {}) => queued('licence', { refused: true, lastErrorCode: code, lastError, ...extra }, { loadId: 'load-a', label: 'L-0003', photos: [] });
  assert.equal(recordLicenceAgain(licence('LICENCE_FORGOTTEN', 'The licence number is no longer on this device; record the licence again.')), true);
  assert.equal(recordLicenceAgain(licence('PHOTO_GONE', 'The licence photos are no longer on this device; record the licence again.')), true);
  assert.equal(recordLicenceAgain(licence('22023', 'The licence expiry must be a real date')), true);
  assert.equal(recordLicenceAgain(licence('42501', 'That load isn’t in your projects')), true);
  assert.equal(recordLicenceAgain(licence('PHOTO_REFUSED', 'Licence recorded; storage refused the photo: 403')), false, 'goes once the office makes room');
  assert.equal(recordLicenceAgain(licence('22023', 'Licence recorded; photo will retry: A load keeps at most 4 licence photos')), false);
  assert.equal(recordLicenceAgain(licence(undefined, 'Licence recorded; photo upload will retry: Network request failed', { refused: false })), false, 'not refused: it retries');
  assert.equal(recordLicenceAgain(queued('load_depart', { refused: true, lastErrorCode: '22023', lastError: 'x' })), false);
});
test('known limits: a discard drops only the photos when the rest is saved already', () => {
  assert.equal(discardKeepsSaved(queued('receiving', { lastError: 'Receipt saved; photo upload will retry: Bucket unavailable' })), true);
  assert.equal(discardKeepsSaved(queued('count', { lastError: 'Photo reference will retry: x' })), true);
  assert.equal(discardKeepsSaved(queued('licence', {}, { recorded: true, photos: [] })), true);
  assert.equal(discardKeepsSaved(queued('licence', { lastError: 'The licence number is no longer on this device; record the licence again.' }, { photos: [] })), false);
  assert.equal(discardKeepsSaved(queued('receiving', { lastError: 'Network request failed' })), false);
  assert.equal(discardKeepsSaved(queued('transfer', { lastError: 'photo' })), false);
});
