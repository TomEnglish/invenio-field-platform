const test=require('node:test'); const assert=require('node:assert/strict');
const {create}=require('zustand');const {createModuleLoader}=require('./helpers/load-typescript.cjs');
const action={type:'issue',payload:{materialId:'m',jobNumber:'JOB',quantity:1,issuedBy:'u'}};
function setup(write=async()=>{}) {
  const records=new Map(), writes=[], checks=[];
  const auth=create(()=>({user:{id:'u'},session:{access_token:'test'},activeProject:{id:'p',status:'active'},accessMode:'online',loading:false,loadSession:async()=>{
    checks.push('verify');auth.setState({loading:true});await Promise.resolve();auth.setState({accessMode:'online',loading:false});
  }}));
  const network=create(()=>({isOnline:true}));
  const loader=createModuleLoader({stubs:{
    '@/stores/authStore':{useAuthStore:auth},
    '@react-native-async-storage/async-storage':{getItem:async k=>records.get(k)??null,setItem:async(k,v)=>{records.set(k,v);}},
    'lib/sync/networkStore.ts':{useNetworkStore:network},
    'lib/api/receiving.ts':{submitReceivingRecord:async(...args)=>{writes.push(args);await write(...args);}},
    'lib/api/materials.ts':{issueMaterial:async(...args)=>{writes.push(args);await write(...args);},transferMaterial:async()=>{}},
    'lib/api/shipments.ts':{createShipment:async()=>{}},
  }});
  return{auth,network,records,writes,checks,queue:loader.load('./lib/sync/offlineQueue.ts'),sync:loader.load('./lib/sync/syncManager.ts')};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('startup drains saved work even when network and identity are already ready',async()=>{
 const h=setup();await h.queue.addToQueue(action);const stop=h.sync.startAutoSync();await settle();stop();assert.equal(h.writes.length,1);assert.equal((await h.queue.getQueue()).length,0);
});
test('offline recovery waits for online permission revalidation before replay',async()=>{
 const h=setup();await h.queue.addToQueue(action);h.auth.setState({accessMode:'offline'});
 await h.sync.processQueue();assert.equal(h.writes.length,0);
 h.network.setState({isOnline:false});const stop=h.sync.startAutoSync();h.network.setState({isOnline:true});await settle();stop();assert.equal(h.checks.length,1);assert.equal(h.writes.length,1);
});
test('a second request during replay awaits completion and drains newly saved work',async()=>{
 let release; const gate=new Promise(resolve=>{release=resolve;});let count=0;
 const h=setup(async()=>{if(++count===1)await gate;});await h.queue.addToQueue(action);
 const first=h.sync.processQueue();await settle();await h.queue.addToQueue({...action,payload:{...action.payload,materialId:'m2'}});
 let finished=false;const second=h.sync.processQueue().then(()=>{finished=true;});await settle();assert.equal(finished,false);release();await Promise.all([first,second]);assert.equal(h.writes.length,2);assert.equal((await h.queue.getQueue()).length,0);
});
test('loss of connectivity preserves the attempt budget and original operation ID',async()=>{
 let h;h=setup(async()=>{h.network.setState({isOnline:false});throw new Error('Network lost');});await h.queue.addToQueue(action);const before=(await h.queue.getQueue())[0];await h.sync.processQueue();const after=(await h.queue.getQueue())[0];assert.equal(after.id,before.id);assert.equal(after.retryCount,0);
});
test('completed project and access revalidation do not consume retries',async()=>{
 const h=setup();await h.queue.addToQueue(action);h.auth.setState({activeProject:{id:'p',status:'completed'}});await h.sync.processQueue();assert.equal(h.writes.length,0);
 h.auth.setState({activeProject:{id:'p',status:'active'},loading:true});await h.sync.processQueue();assert.equal(h.writes.length,0);assert.equal((await h.queue.getQueue())[0].retryCount,0);
});
test('unknown queued actions are retained for recovery rather than discarded',async()=>{
 const h=setup();h.records.set('offline_queue',JSON.stringify([{id:'legacy',userId:'u',projectId:'p',action:{type:'unknown'},createdAt:new Date().toISOString()}]));await h.sync.processQueue();const items=await h.queue.getQueue();assert.equal(items.length,1);assert.match(items[0].lastError,/unsupported|unknown/i);
});
