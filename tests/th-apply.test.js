import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// TH_Apply against a small in-memory sheet that behaves like 提柜: cells, ClearContents, and "cut → insert cut cells".
const source=readFileSync(new URL('../public/airscript/TH_Apply.js',import.meta.url),'utf8');
function sheetOf(rows){
  let data=rows.map(r=>[...r,...Array(16-r.length).fill(null)]);
  const sheet={
    get UsedRange(){return {Row:1,Rows:{Count:data.length}};},
    Cells:(r,c)=>({r,c,get Value2(){return data[r-1][c-1];},set Value2(v){data[r-1][c-1]=v;},ClearContents(){data[r-1][c-1]=null;}}),
    Range(a,b){
      if(typeof a==='string'){const n=Number(a.split(':')[0]);return {Cut(){sheet.cut=n;},Insert(){const row=data[sheet.cut-1];data.splice(sheet.cut-1,1);data.splice(n-1,0,row);sheet.cut=null;}};}
      return {get Value2(){return data.slice(a.r-1,b.r).map(r=>r.slice(a.c-1,b.c));}};
    }
  };
  return {sheet,data:()=>data};
}
function run(rows,payload){
  const {sheet,data}=sheetOf(rows);const logs=[];
  const code=source.replace('const PAYLOAD = null;',`const PAYLOAD = ${JSON.stringify(payload)};`);
  new Function('Application','console',code)({Sheets:()=>sheet},{log:l=>logs.push(l)});
  const results=logs.filter(l=>l.startsWith('TH_CHUNK:')).map(l=>JSON.parse(JSON.parse(l.slice(9)).rows[0]));
  return {results,data:data()};
}
const blank=n=>Array.from({length:n},()=>[]);
const rows=()=>{
  const r=blank(12);
  r[0]=[null,null,null,'未排程 ↓'];
  r[1]=[null,'按码头排'];
  r[2]=['✔','x','M1','AAAU0000001',null,null,'Deck','OWN',null,null,46330,'0001',null,null,null,'LBCT'];
  r[3]=['✔','y','M2','BBBU0000002',null,null,'Ground','OWN',null,null,46330,'0002',null,null,null,'PCT'];
  r[4]=[null,null,null,'未放行 ↓'];
  r[5]=[null,'keep me','M3','CCCU0000003',null,null,'Ground','OWN',null,null,46331,'0003',null,null,null,'TTI'];
  r[6]=[null,'VSL ETA: 11/01','M4','FFAU8773083',null,null,null,'OWN',null,null,null,'0004',null,null,null,'LBCT'];
  r[7]=[null,null,null,'next row stays'];
  return r;
};
test('cells are written only when they still hold the value read, and the row moves next to its terminal',()=>{
  const {results,data}=run(rows(),{id:'t1',changes:[
    {container:'FFAU8773083',mbl:'M4',cells:[{col:'B',column:2,before:'VSL ETA: 11/01',after:'VSL ETA: 11/01,Custom_H'},{col:'G',column:7,before:'',after:'Ground'},{col:'M',column:13,before:'',after:46332},{col:'N',column:14,before:'',after:0.25}]},
    {container:'CCCU0000003',mbl:'M3',cells:[{col:'B',column:2,before:'changed by me',after:'x'}]}
  ],moves:[{container:'FFAU8773083',mbl:'M4',from:7,terminal:'LBCT'}]});
  const ffau=results.find(r=>r.container==='FFAU8773083'&&r.applied);
  assert.deepEqual(ffau.applied,['B','G','M','N']);
  const ccc=results.find(r=>r.container==='CCCU0000003');
  assert.equal(ccc.skipped[0].reason,'读取后被改过');
  const move=results.find(r=>r.move);assert.deepEqual(move.move,{from:7,to:4});
  // Moved under the LBCT row, with its new values; every other row unchanged and in order.
  assert.deepEqual(data.map(r=>r[3]),['未排程 ↓',null,'AAAU0000001','FFAU8773083','BBBU0000002','未放行 ↓','CCCU0000003','next row stays',null,null,null,null]);
  assert.deepEqual(data[3].slice(0,16),[null,'VSL ETA: 11/01,Custom_H','M4','FFAU8773083',null,null,'Ground','OWN',null,null,null,'0004',46332,0.25,null,'LBCT']);
  assert.equal(data[6][1],'keep me');assert.equal(data[4][6],'Ground');
});
test('a terminal with no group goes to the end of the section; a wrong MBL or duplicate is refused',()=>{
  const r=rows();r[6][15]='YTI';
  const moved=run(r,{id:'t2',changes:[],moves:[{container:'FFAU8773083',mbl:'M4',from:7,terminal:'YTI'}]});
  assert.deepEqual(moved.results[0].move,{from:7,to:5});
  assert.equal(moved.data[4][3],'FFAU8773083');assert.equal(moved.data[5][3],'未放行 ↓');
  const wrong=run(rows(),{id:'t3',changes:[{container:'FFAU8773083',mbl:'OTHER',cells:[{col:'G',column:7,before:'',after:'Ground'}]}],moves:[{container:'FFAU8773083',mbl:'OTHER',from:7,terminal:'LBCT'}]});
  assert.equal(wrong.results[0].skipped[0].reason,'MBL 和读取时不一致');
  assert.equal(wrong.results[1].move.skipped,'MBL 和读取时不一致');
  assert.equal(wrong.data[6][6],null);
  const dup=rows();dup[8]=[null,null,'M4','FFAU8773083'];
  assert.equal(run(dup,{id:'t4',changes:[{container:'FFAU8773083',mbl:'M4',cells:[{col:'G',column:7,before:'',after:'Ground'}]}],moves:[]}).results[0].skipped[0].reason,'柜号出现多行');
});
test('a picked row among duplicates is written; a bare container number or history under 取消DO is not a duplicate',()=>{
  const base=rows();base[8]=[null,'取消DO'];base[10]=[null,null,null,'FFAU8773083'];
  const bare=run(base,{id:'t5',changes:[{container:'FFAU8773083',mbl:'M4',cells:[{col:'G',column:7,before:'',after:'Ground'}]}],moves:[]});
  assert.deepEqual(bare.results[0].applied,['G'],'the bare number below 取消DO does not count');
  const dup=rows();dup[7]=[null,'other','M9','FFAU8773083',null,null,null,null,null,null,null,null,null,null,null,'PCT'];
  const refused=run(dup,{id:'t6',changes:[{container:'FFAU8773083',mbl:'M4',cells:[{col:'G',column:7,before:'',after:'Ground'}]}],moves:[]});
  assert.equal(refused.results[0].skipped[0].reason,'柜号出现多行');
  const picked=run(dup,{id:'t7',changes:[{container:'FFAU8773083',mbl:'M4',pick:7,cells:[{col:'G',column:7,before:'',after:'Ground'}]}],moves:[{container:'FFAU8773083',mbl:'M4',from:7,terminal:'LBCT',pick:7}]});
  assert.deepEqual(picked.results[0].applied,['G']);
  assert.deepEqual(picked.results[1].move,{from:7,to:4});
  assert.equal(picked.data[7][1],'other','the other row is untouched');
});
