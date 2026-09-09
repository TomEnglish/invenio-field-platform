const test=require('node:test');const assert=require('node:assert/strict');const {createModuleLoader}=require('./helpers/load-typescript.cjs');
test('a photo captured for one draft cannot attach to a new account/project or receipt',async()=>{
 let operationId='original',saved=[];
 const loader=createModuleLoader({stubs:{
  '@/stores/receivingStore':{useReceivingStore:{getState:()=>({operationId,addPhoto:p=>saved.push(p)})}},
  'lib/utils/persistPhoto.ts':{persistPhoto:async()=>{operationId='different';return 'file:///documents/photo.jpg';}},
 }});
 const {savePhotoToDraft}=loader.load('./lib/utils/savePhotoToDraft.ts');
 await assert.rejects(savePhotoToDraft('file:///camera.jpg','damage','original'),/draft changed/i);assert.equal(saved.length,0);
});
test('photo is attached only after durable storage returns and keeps its selected type',async()=>{
 const saved=[];let copies=0;
 const loader=createModuleLoader({stubs:{
  '@/stores/receivingStore':{useReceivingStore:{getState:()=>({operationId:'original',addPhoto:p=>saved.push(p)})}},
  'lib/utils/persistPhoto.ts':{persistPhoto:async()=>{copies++;assert.equal(saved.length,0);return 'file:///documents/photo.jpg';}},
 }});
 const {savePhotoToDraft}=loader.load('./lib/utils/savePhotoToDraft.ts');
 await savePhotoToDraft('file:///camera.jpg','delivery_ticket','original');assert.equal(copies,1);assert.equal(saved[0].uri,'file:///documents/photo.jpg');assert.equal(saved[0].photo_type,'delivery_ticket');
});
