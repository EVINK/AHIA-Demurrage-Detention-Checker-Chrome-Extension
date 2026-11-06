// v1.2.3: OOCL lookups take the same per-container locks as a send and leave records on 记录.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/core/service.ts';
import {lookupDetail} from '../src/background/oocl.ts';

function service(){
  let db={ledger:{},archive:[]},n=0;
  const s=createService({storage:{get:async()=>structuredClone(db),set:async x=>{db={...db,...structuredClone(x)};}},readSheet:async()=>({records:[],readAt:1}),uuid:()=>`r${++n}`});
  return {s,db:()=>db};
}
const info={carrierId:'oocl',carrierName:'OOCL',inquiryType:'demurrage',typeLabel:'Demurrage',channel:'oocl-rtr'};
const items=[{container:'OOLU1234567',mbl:'OOLU2700000000'},{container:'OOLU7654321',mbl:'OOLU2700000000'}];

test('a container being looked up or already looked up is blocked, and released after a failure', async()=>{
  const {s,db}=service();
  const id=await s.lockLookup({items,...info});
  assert.equal(Object.values(db().ledger).length,2);
  assert.ok(Object.values(db().ledger).every(e=>e.running&&e.channel==='oocl-rtr'));
  await assert.rejects(s.lockLookup({items:[items[1]],...info}),error=>error.duplicate?.length===1&&error.duplicate[0].running===true);
  await s.endLookup(id,entry=>({running:false,status:'queried',detail:entry.container}));
  const done=Object.values(db().ledger);
  assert.deepEqual(done.map(e=>[e.status,e.running,e.detail]),[['queried',false,'OOLU1234567'],['queried',false,'OOLU7654321']]);
  await assert.rejects(s.lockLookup({items,...info}),error=>error.duplicate?.length===2&&!error.duplicate[0].running);
  // A different type is not blocked; a failed run frees its containers.
  const other=await s.lockLookup({items,...info,inquiryType:'detention'});
  await s.endLookup(other,null);
  assert.equal(Object.values(db().ledger).length,2);
  assert.equal(db().archive.length,2);
});

test('the record line of each container', ()=>{
  assert.equal(lookupDetail({lfd:'2026-11-08',ooclLfd:'2026-11-08',draydogLfd:'2026-11-09',row:5,before:'11/9',after:'11/8'},'',false),'LFD 11/08 · SSL 11/08 · Draydog 11/09 · 提柜表 11/9 → 11/8（未写入）');
  assert.equal(lookupDetail({lfd:'2026-11-08',ooclLfd:'2026-11-08',draydogLfd:'',row:5,before:'11/8',after:'11/8'},'',true),'LFD 11/08 · SSL 11/08 · Draydog — · 提柜表不用改');
  assert.equal(lookupDetail({lfd:''},'OOCL 没有查到这个柜子',false),'OOCL 没有查到这个柜子');
});
