// @ts-nocheck
// Matson 查柜 rules, Chrome-free so they are unit tested. Owner, 11/5:
//   1. the Matson containers are the ones Available V2 lists under MATSON: 提柜 rows above 取消DO with P = MATSON,
//      A blank (on every row of that container) and not a bare container number — ListA_Push's own filter, so the
//      list matches V2 without reading it; the MBL is 提柜 column C;
//   2. matson.com tracking by bill of lading gives the events and the vessel;
//   4–5. not discharged yet: the vessel's arrival in LOS ANGELES from the interactive vessel schedule
//      (origin = the shipment's origin, start date = the day it was loaded) → B "ETA mm/dd HH:MM";
//   6. ON HOLD (not released): not pickable; B "HOLD mm/dd HH:MM" followed by each later event
//      ("Discharge mm/dd HH:MM", "OUTGATE mm/dd HH:MM" …);
//   7. discharged: the discharge time is the ETA, no schedule lookup;
//   8. AVAILABLE as the latest event and no hold → A ✔. Matson needs no appointment.
// Matson shows every time in Los Angeles time; the API gives instants, shown here in Los Angeles time too.
import {businessRows} from './chagui-rules.ts';

const TZ='America/Los_Angeles';
const pad=n=>String(n).padStart(2,'0');
export const MATSON_TERMINAL='MATSON';

/** 提柜 column C → the number matson.com tracks: "MATS8051982000" or "8051982000" → "8051982000". */
export function blNumber(mbl){
  const text=String(mbl??'').toUpperCase().replace(/\s/g,'').replace(/^MATS/,'');
  return /^\d{6,}$/.test(text)?text:'';
}

/** An instant (ms) → {mmdd, hhmm, date:'YYYY-MM-DD'} in Los Angeles. */
export function laTime(ms){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
  return {mmdd:`${p.month}/${p.day}`,hhmm:`${p.hour}:${p.minute}`,date:`${p.year}-${p.month}-${p.day}`};
}
const stamp=ms=>{const t=laTime(ms);return `${t.mmdd} ${t.hhmm}`;};

/** A Matson event → its word in column B. */
export function eventWord(status){
  const s=String(status||'').replace(/\s+/g,' ').trim().toUpperCase();
  if(/^CONTAINER ON HOLD/.test(s))return 'HOLD';
  if(/^HOLD RELEASED/.test(s))return 'RELEASED';
  if(/^DISCHARGE/.test(s))return 'Discharge';
  if(/^LOAD/.test(s))return 'LOAD';
  if(/^OUTGATE/.test(s))return 'OUTGATE';
  if(/^INGATE/.test(s))return 'INGATE';
  if(/^AVAILABLE/.test(s))return 'AVAILABLE';
  return (s.split(' ')[0]||'').replace(/[^A-Z0-9_-]/g,'')||'EVENT';
}
const holdReason=status=>String(status||'').replace(/\s+/g,' ').split(' - ').slice(1).join(' - ').trim().toLowerCase();

/** Words this feature adds and removes in column B: "<word> mm/dd[ HH:MM]". Anything else in B stays. */
export const MANAGED=/(^|[\s,，;；])(ETA|HOLD|RELEASED|Discharge|LOAD|OUTGATE|INGATE|AVAILABLE)\s+\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2})?(?=$|[\s,，;；])/gi;
/** Column B: drop this feature's earlier words, keep the team's text, append the new words. */
export function matsonCell(current,words){
  let text=String(current||'').replace(MANAGED,'$1');
  text=text.replace(/\s*[,，]\s*([,，]\s*)+/g,',').replace(/^[\s,，;；]+|[\s,，;；]+$/g,'').replace(/ {2,}/g,' ');
  return words.length?(text?`${text},${words.join(',')}`:words.join(',')):text;
}

/** One tracking answer (the BL's list) → what is known about this container. */
export function observeMatson(container,list){
  const entry=(list||[]).find(e=>`${e.containerNumber||''}${e.checkDigit||''}`.toUpperCase()===container);
  if(!entry)return null;
  const events=(entry.events||[]).filter(e=>Number.isFinite(e.date)).map(e=>({date:e.date,status:String(e.status||'').replace(/\s+/g,' ').trim(),location:String(e.location||'').trim(),word:eventWord(e.status)})).sort((a,b)=>a.date-b.date);
  // Holds by reason: a hold stays until a release with the same reason (a release without a reason ends them all).
  const active=new Map();
  for(const e of events){
    if(e.word==='HOLD')active.set(holdReason(e.status),active.get(holdReason(e.status))??e.date);
    else if(e.word==='RELEASED'){const reason=holdReason(e.status);if(reason&&active.has(reason))active.delete(reason);else if(!reason)active.clear();}
  }
  const holdSince=active.size?Math.min(...active.values()):null;
  const discharge=events.filter(e=>e.word==='Discharge').pop()||null;
  const load=events.filter(e=>e.word==='LOAD').pop()||null;
  const latest=events.filter(e=>!['HOLD','RELEASED'].includes(e.word)).pop()||null;
  return {container,bl:entry.bookingNumber||'',vessel:entry.vessel||'',voyage:entry.voyage??'',direction:entry.direction||'',
    vvd:entry.vessel?`${entry.vessel}${String(entry.voyage??'').padStart(3,'0')}${entry.direction||''}`:'',
    vesselEta:entry.vesselETA||'',origin:entry.originCode||'',loadPort:entry.loadPort||'',events,
    hold:holdSince!==null,holdSince,holdReasons:[...active.keys()].filter(Boolean),
    discharged:discharge?.date??null,loaded:load?.date??null,
    available:holdSince===null&&latest?.word==='AVAILABLE',latest:latest?`${latest.word} ${stamp(latest.date)}`:''};
}

/** The schedule search for a container not discharged yet: origin, start date (loaded day − 2), end date (+40). */
export function scheduleQuery(o,now=Date.now()){
  if(!o||o.discharged||!o.origin)return null;
  const start=new Date((o.loaded??now)-2*86400000),end=new Date(start.getTime()+40*86400000);
  const mmddyyyy=d=>{const t=laTime(d.getTime());const [y,m,day]=t.date.split('-');return `${m}${day}${y}`;};
  return {origin:o.origin,start:mmddyyyy(start),end:mmddyyyy(end)};
}
export const queryKey=q=>`${q.origin}|${q.start}|${q.end}`;

/** The vessel's arrival in the schedule ("Wednesday 11/04/2026 08:00") → "11/04 08:00", or ''. */
export function arrivalOf(o,schedule){
  if(!o?.vvd)return '';
  const row=(schedule||[]).find(r=>String(r.vvd||'').toUpperCase()===o.vvd.toUpperCase());
  const m=String(row?.arrive||'').match(/(\d{1,2})\/(\d{1,2})\/\d{4}\s+(\d{1,2}):(\d{2})/);
  return m?`${pad(m[1])}/${pad(m[2])} ${pad(m[3])}:${m[4]}`:'';
}

/** Column B words for a container. `arrival`: "mm/dd HH:MM" from the schedule ('' when not found). */
export function matsonWords(o,arrival=''){
  // Discharged: the discharge time is the ETA. Otherwise the schedule's arrival, else Matson's ETA day.
  const fallback=String(o.vesselEta||'').match(/^(\d{1,2})\/(\d{1,2})/);
  const eta=o.discharged?stamp(o.discharged):arrival||(fallback?`${pad(fallback[1])}/${pad(fallback[2])}`:'');
  if(!o.hold)return eta?[`ETA ${eta}`]:[];
  // On hold: HOLD and every event after it, then the ETA while the vessel has not discharged.
  const after=o.events.filter(e=>e.date>o.holdSince&&!['HOLD','RELEASED'].includes(e.word)).map(e=>`${e.word} ${stamp(e.date)}`);
  return [`HOLD ${stamp(o.holdSince)}`,...after,...(!o.discharged&&eta?[`ETA ${eta}`]:[])];
}

/** The Matson containers to check, from the 提柜 baseline (parseBaseline): the same filter as ListA_Push. */
export function matsonList(baseline){
  const {rows,markers}=baseline;
  const cancelled=markers?.cancelled?.length===1?markers.cancelled[0]:Infinity;
  const excluded=new Set(rows.filter(r=>r.row<cancelled&&r.A!==''&&/^[A-Z]{4}\d{7}$/.test(r.D)).map(r=>r.D));
  const out=[],skipped=[];
  for(const [container,found] of businessRows(baseline)){
    if(excluded.has(container)||!found.some(r=>r.P.toUpperCase()===MATSON_TERMINAL))continue;
    if(found.length>1){skipped.push({container,reason:`提柜表里有 ${found.length} 行这个柜号，请人工确认`});continue;}
    const row=found[0],bl=blNumber(row.C);
    if(!bl){skipped.push({container,reason:'提柜表 C 列没有 Matson 提单号'});continue;}
    out.push({container,bl,row});
  }
  return {containers:out,skipped};
}

/** Cell changes for TH_Apply: A (✔ only when available and no hold; never overwrites other A content) and B. */
export function matsonPlan(items){
  const changes=[],skipped=[],observed=[];
  for(const {container,row,observation:o,arrival,error} of items){
    if(error||!o){skipped.push({container,reason:error||'Matson 查不到这个柜号（提单号不对或已超过 90 天）'});continue;}
    const words=matsonWords(o,arrival);
    observed.push({container,bl:row.C,row:row.row,vessel:o.vvd,latest:o.latest,hold:o.hold,holdReasons:o.holdReasons,available:o.available,words:words.join(',')});
    const cells=[];
    const B=matsonCell(row.B,words);
    if(B!==String(row.B))cells.push({col:'B',column:2,before:row.B,beforeText:String(row.B),after:B,afterText:B});
    if(row.A===''||row.A==='✔'){const A=o.available?'✔':'';if(A!==row.A)cells.push({col:'A',column:1,before:row.A,beforeText:row.A,after:A,afterText:A});}
    if(cells.length)changes.push({container,mbl:row.C,row:row.row,cells});
  }
  return {changes,moves:[],skipped,observed};
}
