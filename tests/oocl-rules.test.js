import test from 'node:test';
import assert from 'node:assert/strict';
import {rtrDate,rtrRows,searchTerm,isOocl,sslNote,earliest,notedLfd,hasNote,ooclPlan,needsOocl} from '../src/core/oocl-rules.ts';
import {parseBaseline,serialOf} from '../src/core/chagui-rules.ts';
import {normalizeCarriers,channelsFor,missingConfiguration,supportsManyContainers} from '../src/core/core.ts';

test('RTR dates: UTC to the pickup zone, before 06:00 counts as the day before',()=>{
  assert.equal(rtrDate('20261031065900.000','America/Los_Angeles'),'2026-10-30'); // 23:59 PDT on 10/30
  assert.equal(rtrDate('20261031110000.000','America/Los_Angeles'),'2026-10-30'); // 04:00 PDT 10/31 → 10/30
  assert.equal(rtrDate('20261031140000.000','America/Los_Angeles'),'2026-10-31'); // 07:00 PDT
  assert.equal(rtrDate('','America/Los_Angeles'),null);
  assert.equal(rtrDate('20261031140000.000','Not/AZone'),'2026-10-31');
});
test('search rows: container from number + check digit; LFD only for statuses the site shows it for',()=>{
  const rows=rtrRows({cntrData:[
    {cntrNum:'CSNU890800',checkDigit:'0',sizeType:'40HQ',cntrStatus:'Discharged',relStatus:'Held',lfdUtc:'20261031065900.000',pickupTz:'America/Los_Angeles',blNum:'2337980623'},
    {cntrNum:'OOLU123456',checkDigit:'7',cntrStatus:'On Vessel',lfdUtc:'20261031065900.000',pickupTz:'America/Los_Angeles'}]},'OOLU2337980623');
  assert.equal(rows.CSNU8908000.lfd,'2026-10-30');assert.equal(rows.CSNU8908000.status,'Discharged');
  assert.equal(rows.OOLU1234567.lfd,null);
});
test('terms, OOCL recognition, note text',()=>{
  assert.equal(searchTerm('2337980623'),'OOLU2337980623');assert.equal(searchTerm(' oolu2337980623 '),'OOLU2337980623');assert.equal(searchTerm('CSNU8908000'),'CSNU8908000');
  assert.ok(isOocl({line:'OOL'}));assert.ok(isOocl({line:'OOLU'}));assert.ok(isOocl({mbl:'OOLU1'}));assert.ok(!isOocl({line:'COSU',mbl:'COSU1'}));
  assert.equal(sslNote('2026-10-30'),'SSL LFD 10/30');
  assert.equal(earliest('2026-10-31','2026-10-30',null),'2026-10-30');assert.equal(earliest(null,''),'');
  assert.equal(notedLfd([{body:'call first'},{body:'SSL LFD 10/30'}],Date.parse('2026-10-28')),'2026-10-30');
  assert.ok(hasNote([{body:'SSL LFD 10/30'}],'2026-10-30'));assert.ok(!hasNote([{body:'SSL LFD 10/29'}],'2026-10-30'));
});
const baseline=parseBaseline([[5,'','',  'OOLU2337980623','CSNU8908000','','','','',serialOf('2026-10-31'),'','','LBCT'],[6,'','','OOLU1','TGHU1111111','','','','','','','','LBCT']]);
test('plan: earlier LFD to K, note unless already there (owner example 10/30 vs 10/31)',()=>{
  const items=[{container:'CSNU8908000',mbl:'OOLU2337980623'},{container:'TGHU1111111',mbl:'OOLU1'},{container:'MSCU2222222',mbl:'OOLU2'}];
  const found={CSNU8908000:{status:'Discharged',lfd:'2026-10-30'},TGHU1111111:{status:'Discharged',lfd:'2026-11-05'},MSCU2222222:{status:'On Vessel',lfd:null}};
  const draydog={CSNU8908000:{lfd:'2026-10-31',terminal:'LBCT'},TGHU1111111:{lfd:'2026-11-03',terminal:'LBCT'}};
  const notes={TGHU1111111:[{body:'SSL LFD 11/05'}]};
  const p=ooclPlan(items,{found,draydog,notes,baseline});
  assert.deepEqual(p.results.map(r=>[r.container,r.lfd,r.note]),[['CSNU8908000','2026-10-30','SSL LFD 10/30'],['TGHU1111111','2026-11-03','已有'],['MSCU2222222','','']]);
  assert.deepEqual(p.notes,[{container:'CSNU8908000',body:'SSL LFD 10/30'}]);
  assert.deepEqual(p.changes.map(c=>[c.container,c.row,c.cells[0].col,c.cells[0].beforeText,c.cells[0].afterText]),[['CSNU8908000',5,'K','10/31','10/30'],['TGHU1111111',6,'K','','11/03']]);
  assert.match(p.skipped[0].reason,/还没有 Demurrage LFD/);
});
test('查柜 asks OOCL only for written OOCL containers without an SSL LFD',()=>{
  const s=(container,extra)=>({container,category:'Bookable',line:'OOL',mbl:'',noteLfd:null,...extra});
  assert.deepEqual(needsOocl([s('A'),s('B',{noteLfd:'2026-10-30'}),s('C',{line:'MAEU'}),s('D',{category:'IMPORT TRACKING'}),s('E',{line:'',mbl:'OOLU9'})]).map(x=>x.container),['A','E']);
});
test('OOCL Demurrage channel: OOCL only, needs no recipients, an empty email setting moves to it',()=>{
  assert.ok(channelsFor('carrier-13fb1222').includes('oocl-rtr'));assert.ok(!channelsFor('maersk').includes('oocl-rtr'));
  const [oocl]=normalizeCarriers([{id:'carrier-13fb1222',name:'OOCL',greeting:'OOCL',types:[{id:'demurrage',label:'Demurrage',channel:'email',to:[],cc:[],subjectTemplate:'',bodyTemplate:''},{id:'detention',label:'Detention',channel:'email',to:[],cc:[],subjectTemplate:'',bodyTemplate:''}]}]);
  assert.equal(oocl.types[0].channel,'oocl-rtr');assert.equal(oocl.types[1].channel,'email','Detention stays as it is');
  assert.deepEqual(missingConfiguration(oocl,'demurrage'),[]);assert.ok(supportsManyContainers(oocl,'demurrage'));
  const [kept]=normalizeCarriers([{id:'carrier-13fb1222',name:'OOCL',greeting:'OOCL',types:[{id:'demurrage',label:'Demurrage',channel:'email',to:['a@b.com'],cc:[],subjectTemplate:'',bodyTemplate:''}]}]);
  assert.equal(kept.types[0].channel,'email');
});
