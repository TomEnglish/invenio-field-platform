const test = require('node:test');
const assert = require('node:assert/strict');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');
const { receivingReviewIssue } = createModuleLoader({stubs:{zod:require('zod')}}).load('./lib/utils/receivingReview.ts');
function draft() { return {qrCodeValue:'QR-A',material:{material_type:'Pipe',qty:10},po:{},photos:[],inspection:{condition:'good',inspection_pass:true},decision:{status:'partially_accepted',accepted_qty:5,has_exception:false},location:{location_id:'yard-a'}}; }
test('complete receiving review is ready to submit',()=>assert.equal(receivingReviewIssue(draft()),null));
test('editing delivered quantity rechecks an earlier partial acceptance',()=>{const r=draft();r.material.qty=4;assert.equal(receivingReviewIssue(r).step,4);});
test('editing inspection requires an exception decision before submission',()=>{const r=draft();r.inspection.inspection_pass=false;assert.equal(receivingReviewIssue(r).step,4);r.decision.has_exception=true;assert.equal(receivingReviewIssue(r),null);});
test('restored incomplete drafts cannot bypass material or location steps',()=>{const r=draft();r.material.material_type='';assert.equal(receivingReviewIssue(r).step,0);r.material.material_type='Pipe';r.location.location_id='';assert.equal(receivingReviewIssue(r).step,5);});
