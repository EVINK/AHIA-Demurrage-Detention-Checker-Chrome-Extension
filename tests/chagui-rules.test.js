import test from 'node:test';
import assert from 'node:assert/strict';
import {observe,statusCell,targets,plan,parseBaseline,serialOf,mmddOf,hhmmOf,laParts,noteLfd,dateText,timeText} from '../src/core/chagui-rules.ts';

const container=(over={})=>({container_number:'TRHU6793446',cycle_state:'import_appt_booked',last_related_terminal:'everport',last_free_date:'2026-11-05',line_last_free_date:null,note_body:null,
  import_status:{terminal:'everport',holds:[],parsed_holds:[],wheeled:false,closed_area:false,ready_for_appointment:true,available_for_pickup:true,location:'In Yard',extra_data:{'Wheeled/Decked':'Decked'}},
  import_statuses:[],latest_appointment:{status:'scheduled',window_start:'2026-11-05T15:00:00Z',window_end:'2026-11-05T16:00:00Z'},...over});
const row=(over={})=>({row:300,A:'',B:'',C:'MBL1',D:'TRHU6793446',G:'',H:'',K:'',M:'',N:'',P:'ETS',...over});

test('dates and times round-trip the sheet formats',()=>{
  assert.equal(serialOf('2026-11-05'),46331);assert.equal(mmddOf(46331),'11/05');
  assert.equal(hhmmOf(0.708333333333333),'17:00');assert.equal(hhmmOf(0.1875),'04:30');
  assert.equal(dateText('11/6'),'11/06');assert.equal(timeText(0.375),'09:00');
  assert.deepEqual(laParts('2026-11-05T15:00:00Z'),{date:'2026-11-05',time:'07:00'});
  assert.deepEqual(laParts('2026-11-04T02:00:00Z'),{date:'2026-11-03',time:'18:00'});
  assert.equal(noteLfd('SSL LFD 11/06',Date.parse('2026-11-05')),'2026-11-06');
  assert.equal(noteLfd('SSL LFD 01/02',Date.parse('2026-12-30')),'2027-01-02');
  assert.equal(noteLfd('HOLD'),null);
});
test('Dray Dog data becomes a status: holds, deck evidence in values only, appointment in LA time',()=>{
  const s=observe(container());
  assert.equal(s.category,'Appointed');assert.equal(s.position,'Deck');assert.deepEqual(s.holds,[]);
  assert.deepEqual(s.appointment&&[s.appointment.date,s.appointment.time],['2026-11-05','07:00']);
  const keyOnly=observe(container({import_status:{...container().import_status,extra_data:{'Wheeled/Decked':null},location:'Grounded'}}));
  assert.equal(keyOnly.position,'Ground','the key name "Wheeled/Decked" is not evidence');
  const wheeled=observe(container({import_status:{...container().import_status,wheeled:true,extra_data:{}}}));
  assert.equal(wheeled.position,'Wheeled');
  const held=observe(container({import_status:{...container().import_status,parsed_holds:[{type:'Customs Hold',raw_type:'Customs'},{type:'Line Hold',raw_type:'Line'},{type:'Customs Hold',raw_type:'Customs Status Unavailable'}]}}));
  assert.deepEqual(held.holds,['Custom_H','Line_H']);
  const cancelled=observe(container({latest_appointment:{status:'cancelled',window_start:'2026-10-31T05:00:00Z'}}));
  assert.equal(cancelled.appointment,null);
  assert.equal(observe(container({cycle_state:'import_appt_booking'})).category,'Bookable');
});
test('the status cell keeps the team text and only adds or removes hold words',()=>{
  assert.equal(statusCell('VSL ETA: 10/21,Custom_H',[]),'VSL ETA: 10/21');
  assert.equal(statusCell('Custom_H VSL ETA: 10/31',[]),'VSL ETA: 10/31');
  assert.equal(statusCell('VSL ETA: 10/26',['Line_H']),'VSL ETA: 10/26,Line_H');
  assert.equal(statusCell('Closed_Area,Line_H',['Line_H']),'Line_H');
  assert.equal(statusCell('9/18卸船Freight_H',[]),'9/18卸船');
  assert.equal(statusCell('Line_H ctf_H',['Line_H','CTF_H']),'Line_H ctf_H');
  assert.equal(statusCell('CEX-Xray ,Line_H',['CEX']),'CEX-Xray');
  assert.equal(statusCell('',['Custom_H','Closed_Area']),'Custom_H,Closed_Area');
  assert.equal(statusCell('Line_H',['Line_H']),'Line_H');
});
test('targets follow the owner rules',()=>{
  const free=targets(observe(container()),row());
  assert.deepEqual(free,{A:'✔',B:'',G:'Deck',H:'OWN',K:'2026-11-05',M:'2026-11-05',N:'07:00'});
  const held=targets(observe(container({import_status:{...container().import_status,parsed_holds:[{type:'Line Hold',raw_type:'Line'}]}})),row());
  assert.equal(held.A,'');assert.equal(held.B,'Line_H');assert.equal(held.M,'2026-11-05','an appointment is written even with a hold');
  const closed=targets(observe(container({import_status:{...container().import_status,closed_area:true}})),row());
  assert.equal(closed.A,'');assert.equal(closed.B,'Closed_Area');
  const note=targets(observe(container({note_body:'SSL LFD 11/03'})),row());
  assert.equal(note.K,'2026-11-03','the earlier of the note and Dray Dog');
  const lineOnly=targets(observe(container(),Date.now(),{lineCheck:true}),row({K:46330}));
  assert.equal(lineOnly.K,'','"Check Line for LFD" without a line date is blank');
  assert.equal(targets(observe(container({note_body:'SSL LFD 11/04'}),Date.now(),{lineCheck:true}),row()).K,'2026-11-04');
  const release=observe(container({import_status:{...container().import_status,parsed_holds:[{type:'Customs Hold',raw_type:'Customs BL Genereal Release'}]}}));
  assert.deepEqual(release.holds,['Custom_H'],'LBCT reports this as NO (HOLD)');
  const none=targets(observe(container({last_free_date:null,import_status:{...container().import_status,last_free_date:null}})),row({K:46330}));
  assert.equal(none.K,'','unknown LFD is blank');
  const rent=targets(observe(container()),row({G:'Ground',H:'RENT'}));
  assert.equal(rent.G,'Deck');assert.equal(rent.H,undefined,'manual chassis notes stay');
  const bookable=targets(observe(container({cycle_state:'import_appt_booking'})),row({M:46330,N:0.5}));
  assert.equal(bookable.M,undefined);assert.equal(bookable.N,undefined);
  assert.deepEqual(targets(observe(container({cycle_state:'import_tracking_on_vessel'})),row()),{});
});
const baselineRows=[
  [4,'','','','排程: 11/03','','','','','','','',''],
  [204,'','','','未排程 ↓','','','','','','','',''],
  [221,'','按码头排','','','','','','','','','',''],
  [222,'','','M2','EGSU0000001','','','Ground','OWN','','','','ETS'],
  [274,'','','','未放行 ↓','','','','','','','',''],
  [300,'','VSL ETA: 10/26','MBL1','TRHU6793446','40HC','EMC','','',46330,'','','ETS'],
  [301,'','','MBL3','OOCU0000003','','','','','','','','PCT'],
  [302,'','5631 倉儲','','','','','','','','','',''],
  [637,'','取消DO','','','','','','','','','',''],
  [700,'','','MBL9','CCCU0000009','','','','','','','','APM']
];
test('the plan lists only changed cells, moves rows below 未放行 and skips what needs a person',()=>{
  const baseline=parseBaseline(baselineRows);
  assert.deepEqual(baseline.markers,{unscheduled:[204],unreleased:[274],byTerminal:[221],cancelled:[637]});
  const statuses=[observe(container()),observe(container({container_number:'OOCU0000003'})),observe(container({container_number:'CCCU0000009'})),observe(container({container_number:'ZZZU0000000'}))];
  const result=plan(statuses,baseline);
  const first=result.changes.find(c=>c.container==='TRHU6793446');
  assert.deepEqual(first.cells.map(c=>c.col),['A','G','H','K','M','N'],'B already right: the ETA text stays untouched');
  assert.equal(first.cells.find(c=>c.col==='K').after,46331);
  assert.deepEqual(result.moves.map(m=>[m.container,m.from,m.terminal]),[['TRHU6793446',300,'ETS']]);
  assert.ok(result.skipped.some(s=>s.container==='OOCU0000003'&&/附属行/.test(s.reason)));
  assert.ok(result.skipped.some(s=>s.container==='ZZZU0000000'&&/找不到/.test(s.reason)));
  assert.ok(!result.changes.some(c=>c.container==='CCCU0000009'),'rows under 取消DO are left alone');
  // Already right: nothing to do.
  const same=parseBaseline([[204,'','','','未排程 ↓','','','','','','','',''],[221,'','按码头排','','','','','','','','','',''],[230,'✔','','MBL1','TRHU6793446','','','Deck','OWN',46331,46331,7/24,'ETS'],[274,'','','','未放行 ↓','','','','','','','','']]);
  assert.deepEqual(plan([observe(container())],same).changes,[]);
});
