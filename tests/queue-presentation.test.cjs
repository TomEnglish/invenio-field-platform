const test=require('node:test'),assert=require('node:assert/strict');
const {createModuleLoader}=require('./helpers/load-typescript.cjs');
const {queueSummary,queueRecoveryMessage}=createModuleLoader().load('./lib/sync/queuePresentation.ts');
test('receiving queue uses material and PO without repeating the prefix',()=>{const value=queueSummary({action:{type:'receiving',payload:{material:{material_type:'Pipe',qty:5},po:{po_number:'PO-123',vendor:'Supply'}}}});assert.equal(value.title,'Pipe');assert.equal(value.detail,'Receiving · PO-123 · 5 delivered · Supply');});
test('legacy submissions remain readable without missing payload errors',()=>{assert.equal(queueSummary({action:{type:'receiving'}}).title,'Receiving');assert.equal(queueSummary({action:{type:'unknown'}}).title,'Saved submission');});
test('photo and access failures provide distinct recovery instructions',()=>{assert.match(queueRecoveryMessage({lastError:'Receipt saved; photo upload will retry'}),/same submission/);assert.match(queueRecoveryMessage({lastError:'Access denied'}),/sign-in/);assert.match(queueRecoveryMessage({deadLetter:true}),/Automatic retries have stopped/);});
