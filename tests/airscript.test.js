import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/airscript/LFD_ReadOnly.js',import.meta.url),'utf8');
const timestamp=1700000000000;

function runScript(input){
  const before=structuredClone(input),logs=[],reads=[];
  let writes=0;
  const denyWrite=()=>{writes++;throw new Error('Test blocked a workbook write');};
  const readonly=value=>{
    if(value===null||typeof value!=='object')return value;
    const copy=Array.isArray(value)?value.map(readonly):Object.fromEntries(Object.entries(value).map(([key,item])=>[key,readonly(item)]));
    return new Proxy(copy,{set:denyWrite,deleteProperty:denyWrite,defineProperty:denyWrite});
  };
  const width=Math.max(...input.map(row=>row.length));
  const cells=input.map(row=>Array.from({length:width},(_,column)=>row[column]??''));
  const sheet=readonly({
    UsedRange:{Row:1,Column:1,Rows:{Count:cells.length},Columns:{Count:width}},
    Cells:(row,column)=>({row,column}),
    Range:(from,to)=>{
      assert.ok(from.row>=1&&from.column>=1&&to.row<=cells.length&&to.column<=width,'read remains within the fixture');
      reads.push({from,to});
      return readonly({Value2:cells.slice(from.row-1,to.row).map(row=>row.slice(from.column-1,to.column))});
    }
  });
  const Application=readonly({Sheets:name=>{assert.equal(name,'提柜');return sheet;}});
  let result;
  try{result=vm.runInNewContext(source,{Application,console:{log:line=>logs.push(String(line))},Date:{now:()=>timestamp}});}
  catch(error){
    assert.equal(writes,0,'a rejected script still made no workbook write');
    assert.deepEqual(input,before,'a rejected script left the fixture unchanged');
    assert.equal(logs.length,0,'an invalid field never published a partial result');
    throw error;
  }
  assert.equal(writes,0,'no workbook or returned-cell write occurred');
  assert.deepEqual(input,before,'fixture cells remain unchanged');
  const start=JSON.parse(logs.find(line=>line.startsWith('LFD_START:')).slice(10));
  const pieces=logs.filter(line=>line.startsWith('LFD_CHUNK:')).map(line=>JSON.parse(line.slice(10)));
  assert.equal(start.version,2);assert.equal(start.id,timestamp);assert.equal(start.sheet,'提柜');
  assert.equal(start.chunks,pieces.length);assert.equal(logs.at(-1),'LFD_END:'+timestamp);
  pieces.forEach((piece,index)=>{assert.equal(piece.id,timestamp);assert.equal(piece.index,index);assert.ok(piece.rows.length<=6);});
  const rows=pieces.flatMap(piece=>piece.rows);
  assert.equal(rows.length,start.count);assert.ok(rows.every(row=>row.length===4),'v2 emits exactly four fields per record');
  return {result:JSON.parse(JSON.stringify(result)),start,pieces,rows,logs,reads};
}

test('AirScript v2 recognizes Chinese and English carrier column names and emits four fields',()=>{
  for(const carrierHeader of ['船司','航司','carrier','船公司','Shipping Line']){
    const run=runScript([
      ['说明','此表用于提柜'],
      ['MBL#','Container #',carrierHeader],
      [' MAEU276301677 ',' mrsu4786640 ',' MSK '],
      ['MEDUYI141936','MSMU8984372','MSC']
    ]);
    assert.deepEqual(run.rows,[['MRSU4786640','MAEU276301677',3,'MSK'],['MSMU8984372','MEDUYI141936',4,'MSC']]);
    assert.deepEqual(run.result.records.map(record=>record.carrier),['MSK','MSC']);
    assert.equal(run.result.version,2);assert.equal(run.start.cancelledSections,0);
  }
});

test('AirScript v2 emits an empty carrier when the optional column is absent or its cell is blank',()=>{
  const absent=runScript([['MBL','柜号'],['MAEU276301677','MRSU4786640']]);
  assert.deepEqual(absent.rows,[['MRSU4786640','MAEU276301677',2,'']]);
  const blank=runScript([['柜号','船司','MBL'],['MRSU4786640','','MAEU276301677']]);
  assert.equal(blank.result.records[0].carrier,'');assert.equal(blank.rows[0][3],'');
});

test('AirScript v2 retains source row numbers for the Maersk and MSC examples',()=>{
  const input=Array.from({length:357},()=>['','','']);input[0]=['MBL','柜号','船司'];
  input[44]=['MEDUYI141936','MSMU8984372','MSC'];input[354]=['MAEU276301677','MRSU4786640','MSK'];
  input[355]=['取消DO','',''];input[356]=['SHOULDNOTREAD','ABCU9999999','MSC'];
  const run=runScript(input);
  assert.deepEqual(run.rows,[['MSMU8984372','MEDUYI141936',45,'MSC'],['MRSU4786640','MAEU276301677',355,'MSK']]);
  assert.equal(run.result.cancelledSections,1);assert.equal(run.result.skippedRows,1);
});

test('AirScript v2 dynamically splits long and JSON-escaped fields below 1000 characters per log',()=>{
  const input=[['柜号','MBL','船公司']];
  for(let index=0;index<37;index++)input.push(['LONG'+String(index).padStart(7,'0'),'M'.repeat(100),'船'.repeat(60)+'"\\'.repeat(30)]);
  const run=runScript(input);
  assert.equal(run.rows.length,37);assert.ok(run.pieces.length>Math.ceil(37/6),'long rows split before the six-row cap');
  assert.ok(run.logs.every(line=>line.length<1000),`longest log is ${Math.max(...run.logs.map(line=>line.length))}`);
  assert.ok(run.rows.every((row,index)=>row[0]===input[index+1][0]&&row[1]===input[index+1][1]&&row[3]===input[index+1][2]));
});

test('AirScript v2 returns all valid records across 500-row batches and skips a trailing cancelled section without writes',()=>{
  const input=[['柜号','MBL','承运人']];
  for(let index=0;index<1234;index++)input.push(['TSTU'+String(index).padStart(7,'0'),'MAEU'+String(index).padStart(9,'0'),index%2?'MSK':'']);
  input.push(['not a container','invalid row','MSC']);
  input.push(['','取消 D / O','']);
  input.push(['ABCU9999999','MEDU999999999','MSC']);
  const run=runScript(input);
  assert.equal(run.start.count,1234);assert.equal(run.result.records.length,1234);assert.equal(run.rows.at(-1)[2],1235);
  assert.equal(run.start.cancelledSections,1);assert.ok(!run.rows.some(row=>row[0]==='ABCU9999999'));
  assert.ok(run.reads.some(read=>read.from.row===502));assert.ok(run.reads.some(read=>read.from.row===1002));
  assert.deepEqual(run.rows.map(row=>row[0]),input.slice(1,1235).map(row=>row[0]));
  assert.ok(run.logs.every(line=>line.length<1000));
});

test('AirScript v2 rejects overlong MBL or carrier fields before publishing a partial result',()=>{
  for(const values of [['M'.repeat(101),'MSC'],['MAEU276301677','S'.repeat(121)]]){
    assert.throws(()=>runScript([['柜号','MBL','船司'],['MRSU4786640',...values]]),/字段过长/);
  }
});

// Mirrors the real 提柜 layout seen 2026-10-14: 取消DO at B854, cancelled and 进口 rows, then 已送仓 / 排程 with CSNU5509665 at row 886.
test('AirScript v2 resumes after the 取消DO section at the 已送仓 / 排程 headers',()=>{
  const input=[['放行','运输/扣留/查验信息','MBL','柜号','柜型','船司'],['','','','排程：10/14','','']];
  input.push(['✓','VSL ETA: 10/08','COSU6465759270','CCLU7603590','40HC','COS']);
  input.push(['','取消DO','','','','']);
  input.push(['✕','VSL ETA: 10/02','EGLV143651','TGBU6783526','40HC','EMC']);
  input.push(['','进口 BL#ZIMUNGB20877134','','GAOU6135832','40HC','ZIM']);
  input.push(['','','','已送仓 ↓','','']);
  input.push(['','','','排程: 10/13','','']);
  input.push(['✓','VSL ETA: 10/10','COSU6466280560','CSNU5509665','40HC','COS']);
  input.push(['','','','排程：10/12','','']);
  input.push(['✓','STA','MATS4624394','MATU2151001','20HC','MATSON']);
  const run=runScript(input);
  assert.deepEqual(run.rows,[
    ['CCLU7603590','COSU6465759270',3,'COS'],
    ['CSNU5509665','COSU6466280560',9,'COS'],
    ['MATU2151001','MATS4624394',11,'MATSON']
  ]);
  assert.equal(run.start.cancelledSections,1);assert.equal(run.start.skippedRows,2);
  assert.ok(!run.rows.some(row=>['TGBU6783526','GAOU6135832'].includes(row[0])),'cancelled-section rows stay excluded');
});

test('bundled AirScript declares the build that it reports when run',()=>{
  const build=Number(source.match(/LFD build:\s*(\d+)/)[1]);
  const run=runScript([['柜号','MBL','船司'],['MRSU4786640','MAEU276301677','MSK']]);
  assert.ok(build>=3);assert.equal(run.start.build,build);
});
