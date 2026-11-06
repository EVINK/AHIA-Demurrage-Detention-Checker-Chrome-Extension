import test from 'node:test';
import assert from 'node:assert/strict';
import {blNumber,observeMatson,scheduleQuery,arrivalOf,matsonWords,matsonCell,matsonList,matsonPlan,eventWord} from '../src/core/matson-rules.ts';
import {parseBaseline} from '../src/core/chagui-rules.ts';

// Real answers from matson.com, 11/5 (the owner's screenshots).
const ev=(date,status,location='')=>({date,status,location});
const DKI={vessel:'DKI',voyage:102,direction:'E',vesselETA:'11/04/26',originCode:'SHA',loadPort:'SHANGHAI'};
const held=[{...DKI,bookingNumber:'8051982',containerNumber:'MATU259066',checkDigit:'3',events:[
  ev(1792473600000,'INGATE                              Full by SHANGHAI   ','SHANGHAI'),
  ev(1792865100000,'CONTAINER ON HOLD                   - Customs Clearance'),
  ev(1792900800000,'LOAD TO VESSEL                      DANIEL K. INOUYE 102','SHANGHAI')]}];
const available=[{...DKI,bookingNumber:'8112198',containerNumber:'MATU265059',checkDigit:'3',events:[
  ev(Date.parse('2026-11-05T02:03:01Z'),'AVAILABLE ','SHIPPERS TRANSPORT MIDDLE ROAD - Wilmington'),
  ev(Date.parse('2026-11-05T02:03:00Z'),'INGATE Full by SHIPPERS TRANSPORT EXPRESS'),
  ev(Date.parse('2026-11-05T01:47:00Z'),'OUTGATE to SHIPPERS TRANSPORT EXPRESS','LONG BEACH (CA)'),
  ev(Date.parse('2026-11-04T21:39:00Z'),'DISCHARGE FROM VESSEL DANIEL K. INOUYE 102','LONG BEACH (CA)'),
  ev(Date.parse('2026-11-04T07:27:00Z'),'HOLD RELEASED - Customs Clearance'),
  ev(Date.parse('2026-10-25T04:00:00Z'),'LOAD TO VESSEL DANIEL K. INOUYE 102','SHANGHAI'),
  ev(Date.parse('2026-10-24T18:05:00Z'),'CONTAINER ON HOLD - Customs Clearance'),
  ev(Date.parse('2026-10-20T15:19:00Z'),'INGATE Full by SHANGHAI','SHANGHAI')]}];
const SCHEDULE=[{arrive:'Wednesday 11/04/2026 08:00',depart:'Saturday 10/24/2026 20:42',vvd:'DKI102E'},{arrive:'Sunday 11/08/2026 12:30',vvd:'MAT077E'}];

test('MBL → the number matson.com tracks',()=>{
  assert.equal(blNumber('MATS8051982000'),'8051982000');
  assert.equal(blNumber(' 8112198000 '),'8112198000');
  assert.equal(blNumber('COSU123'),'');
  assert.equal(blNumber(''),'');
});

test('on hold, not discharged: HOLD, the events after it, and the schedule ETA',()=>{
  const o=observeMatson('MATU2590663',held);
  assert.equal(o.hold,true);assert.equal(o.available,false);assert.equal(o.vvd,'DKI102E');
  const q=scheduleQuery(o);
  assert.deepEqual(q,{origin:'SHA',start:'10222026',end:'12012026'});
  const arrival=arrivalOf(o,SCHEDULE);
  assert.deepEqual(arrival,{text:'11/04 08:00',key:'2026-11-04 08:00'});
  // One status, the latest time (owner, 11/6).
  assert.deepEqual(matsonWords(o,arrival),['ETA 11/04 08:00']);
  // No schedule: Matson's ETA day is still later than the hold and the loading.
  assert.deepEqual(matsonWords(o),['ETA 11/04']);
  // An ETA already in the past: the latest event wins.
  assert.deepEqual(matsonWords(o,{text:'10/20 08:00',key:'2026-10-20 08:00'}),['LOAD 10/24 21:00']);
});

test('old hand-written Matson statuses are replaced by the one status',()=>{
  assert.equal(matsonCell('VSL ETA: 11/08',['ETA 11/08 12:30']),'ETA 11/08 12:30');
  assert.equal(matsonCell('HOLD RELEASED',['ETA 11/05 05:26']),'ETA 11/05 05:26');
  assert.equal(matsonCell('倉儲 VSL ETA: 11/08,HOLD 10/28 11:37,LOAD 10/28 23:04',['ETA 11/08 12:30']),'倉儲,ETA 11/08 12:30');
});

test('released, discharged and AVAILABLE: ETA is the discharge time, A gets ✔',()=>{
  const o=observeMatson('MATU2650593',available);
  assert.equal(o.hold,false);assert.equal(o.available,true);
  assert.equal(scheduleQuery(o),null);
  assert.deepEqual(matsonWords(o),['ETA 11/04 13:39']);
  const plan=matsonPlan([{container:'MATU2650593',row:{row:12,A:'',B:'ETA 11/04 倉儲',C:'MATS8112198000'},observation:o}]);
  assert.deepEqual(plan.changes[0].cells.map(c=>[c.col,c.after]),[['B','倉儲,ETA 11/04 13:39'],['A','✔']]);
});

test('a container not in the answer, or an unknown event',()=>{
  assert.equal(observeMatson('MATU1111111',held),null);
  assert.equal(eventWord('RAIL DEPARTURE x'),'RAIL');
  const plan=matsonPlan([{container:'MATU1111111',row:{row:3,A:'',B:'',C:'1'},observation:null}]);
  assert.equal(plan.changes.length,0);assert.equal(plan.skipped.length,1);
});

test('column B keeps the team text and replaces only its own words',()=>{
  assert.equal(matsonCell('Custom_H, HOLD 10/24 11:05,ETA 11/04 08:00',['ETA 11/05 05:26']),'Custom_H,ETA 11/05 05:26');
  assert.equal(matsonCell('',['ETA 11/04 08:00']),'ETA 11/04 08:00');
  assert.equal(matsonCell('倉儲',[]),'倉儲');
  // Already right: no change.
  const o=observeMatson('MATU2650593',available);
  assert.equal(matsonPlan([{container:'MATU2650593',row:{row:12,A:'✔',B:'ETA 11/04 13:39',C:'8112198000'},observation:o}]).changes.length,0);
});

test('the list: MATSON rows above 取消DO with A blank everywhere, like ListA_Push',()=>{
  const r=(row,A,B,C,D,P)=>[row,A,B,C,D,'','','','','','','',P];
  const baseline=parseBaseline([
    r(5,'','','MATS8051982000','MATU2590663','MATSON'),
    r(6,'✔','','MATS8112198000','MATU2650593','MATSON'),
    r(7,'','','','MATU3333333','MATSON'),
    r(8,'','','12345678','TGHU1234567','APM'),
    r(9,'','取消DO','','',''),
    r(10,'','','MATS1','MATU4444444','MATSON')]);
  const list=matsonList(baseline);
  assert.deepEqual(list.containers.map(c=>[c.container,c.bl]),[['MATU2590663','8051982000']]);
  assert.deepEqual(list.skipped.map(s=>s.container),['MATU3333333']);
});
