// @ts-nocheck
// OOCL Demurrage LFD (owner, 11/6), Chrome-free so it is unit tested. OOCL's Real Time Release site
// (rtr.home.oocl.com, sign-in through OOCL's Keycloak at exiamfw.home.oocl.com) answers
// GET /api/todo/search/<MBL or container> with {cntrData:[…], messages}. Each row carries the container
// (cntrNum + checkDigit), its status and `lfdUtc` ('YYYYMMDDHHmmss.SSS', UTC) with the pickup time zone.
// The site shows the Demurrage Last Free Date only for some statuses, in the pickup zone, and an instant before
// 06:00 there counts as the day before (the page's own code). Owner's rules: the Draydog note says "SSL LFD mm/dd";
// the LFD written to column K is the earlier of OOCL's and Draydog's.
import {businessRows,SHOWN,serialOf,COLUMNS,noteLfd} from './chagui-rules.ts';

export const RTR_URL='https://rtr.home.oocl.com/';
export const LOGIN_ORIGIN='https://exiamfw.home.oocl.com/';
export const LFD_STATUSES=['On Train','Discharged','At Location','Out for Delivery','Empty Returned'];
const pad=n=>String(n).padStart(2,'0');

/** An OOCL container: Draydog's shipping line (OOL / OOLU) or an OOLU bill of lading. */
export const isOocl=({line='',mbl=''}={})=>/^OOL/i.test(String(line||'').trim())||/^OOLU/i.test(String(mbl||'').trim());
/** What to type in RTR's search box for a bill of lading: as given; bare digits get OOLU. */
export function searchTerm(value){
  const text=String(value||'').toUpperCase().replace(/[\s-]/g,'');
  return /^\d{6,}$/.test(text)?'OOLU'+text:text;
}
export const containerOf=(number,check)=>(String(number||'')+String(check??'')).toUpperCase().replace(/[^A-Z0-9]/g,'');
/** RTR's date rule: 'YYYYMMDDHHmmss.SSS' (UTC) in the pickup zone; before 06:00 is the previous day. → 'YYYY-MM-DD'. */
export function rtrDate(utc,zone){
  const m=String(utc||'').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if(!m)return null;
  const instant=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);
  let parts;
  try{parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone||'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));}
  catch{return rtrDate(utc,'America/Los_Angeles');}
  const day=new Date(Date.UTC(+parts.year,+parts.month-1,+parts.day-(+parts.hour<6?1:0)));
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth()+1)}-${pad(day.getUTCDate())}`;
}
/** One search answer → {container: row}. lfd is null where the site shows none (status not yet discharged, no date). */
export function rtrRows(answer,term=''){
  const out={};
  for(const r of answer?.cntrData||[]){
    const container=containerOf(r.cntrNum,r.checkDigit);
    if(!/^[A-Z]{4}\d{7}$/.test(container))continue;
    const shown=LFD_STATUSES.includes(r.cntrStatus);
    out[container]={container,term,bl:String(r.blNum||''),status:String(r.cntrStatus||''),release:String(r.relStatus||''),size:String(r.sizeType||''),
      vessel:String(r.vessel||''),lfd:shown?rtrDate(r.lfdUtc,r.pickupTz):null};
  }
  return out;
}
export const mmdd=iso=>iso?iso.slice(5).replace('-','/'):'';
export const sslNote=iso=>`SSL LFD ${mmdd(iso)}`;
export const earliest=(...dates)=>dates.filter(Boolean).sort()[0]||'';
/** The "SSL LFD" date already in any of a container's Draydog notes (newest first), or null. */
export function notedLfd(notes,near=Date.now()){
  for(const note of notes||[]){const iso=noteLfd(note?.body??note,near);if(iso)return iso;}
  return null;
}
/** Has this exact note already been written? */
export const hasNote=(notes,iso)=>(notes||[]).some(n=>noteLfd(n?.body??n,Date.parse(iso))===iso&&/SSL\s*LFD/i.test(n?.body??n));

/**
 * The query page's OOCL run: per container, OOCL's LFD, Draydog's, the earlier one for column K, and the note.
 * items [{container, mbl}]; found {container: rtr row}; draydog {container: observe() status}; notes {container:[note]};
 * baseline: TH_ReadPickup rows (parseBaseline). → {results, changes, notes, skipped}
 */
export function ooclPlan(items,{found={},draydog={},notes={},baseline}){
  const rows=baseline?businessRows(baseline):new Map();
  const results=[],changes=[],toNote=[],skipped=[];
  for(const {container,mbl} of items){
    const oocl=found[container]||null,dd=draydog[container]||null;
    const ddLfd=dd?(dd.lfd||dd.lineLfd||null):null;
    const result={container,mbl,status:oocl?.status||'',release:oocl?.release||'',ooclLfd:oocl?.lfd||'',draydogLfd:ddLfd||'',terminal:dd?.terminal||'',tracked:Boolean(dd),lfd:'',note:'',row:null,before:'',after:''};
    results.push(result);
    if(!oocl){skipped.push({container,mbl,reason:'OOCL 没有查到这个柜子'});continue;}
    if(!oocl.lfd){skipped.push({container,mbl,reason:`OOCL 还没有 Demurrage LFD（${oocl.status||'状态未知'}）`});continue;}
    // 5. The note, unless this exact one is already there.
    if(!dd)result.note='Draydog 未追踪，未写 note';
    else if(hasNote(notes[container],oocl.lfd))result.note='已有';
    else{result.note=sslNote(oocl.lfd);toNote.push({container,body:sslNote(oocl.lfd)});}
    // 6. The earlier date.
    result.lfd=earliest(oocl.lfd,ddLfd);
    // 7. Column K of the container's own row.
    const matches=rows.get(container)||[];
    if(matches.length!==1){skipped.push({container,mbl,reason:matches.length?`提柜表里有 ${matches.length} 行这个柜号，K 列请人工更新`:'提柜表里找不到这个柜号，K 列没有更新'});continue;}
    const row=matches[0],afterText=mmdd(result.lfd);
    Object.assign(result,{row:row.row,before:SHOWN.K(row.K),after:afterText});
    if(SHOWN.K(row.K)===afterText)continue;
    changes.push({container,mbl:row.C,row:row.row,cells:[{col:'K',column:COLUMNS.K,before:row.K,beforeText:SHOWN.K(row.K),after:serialOf(result.lfd),afterText}]});
  }
  return {results,changes,notes:toNote,skipped};
}

/**
 * 查柜 step: the OOCL containers that will be written and have no "SSL LFD" note yet. statuses: observe() output
 * (with `line`). Returns those needing an OOCL lookup.
 */
export const needsOocl=statuses=>statuses.filter(s=>['Appointed','Bookable'].includes(s.category)&&isOocl({line:s.line,mbl:s.mbl})&&!s.noteLfd);
