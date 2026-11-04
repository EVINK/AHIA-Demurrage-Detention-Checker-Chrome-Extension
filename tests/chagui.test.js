import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeCache,importCache,emptyCache,pushedCount,STEPS} from '../src/background/chagui.ts';

const list=(readAt,...pairs)=>({readAt,stamp:'s'+readAt,containers:pairs.map(([container,terminal])=>({container,terminal}))});
test('the ListA_Push log line gives the pushed count',()=>{
  assert.equal(pushedCount('11/3/2026, 15:42:30 | 提柜 行 1–636 | 363 柜'),363);
  assert.equal(pushedCount('List A 已写入：11/3/2026, 15:42:30 | 提柜 行 1–636 | 0 柜'),0);
  assert.equal(pushedCount('something else'),null);
});
test('the cache marks the latest list, keeps history and records each run',()=>{
  const first=mergeCache(null,list(1000,['AAAU1234567','APM'],['BBBU1234567','TTI']),1000);
  assert.equal(first.cache.schemaVersion,1);
  assert.deepEqual(first.added,['AAAU1234567','BBBU1234567']);assert.deepEqual(first.removed,[]);
  const second=mergeCache(first.cache,list(2000,['BBBU1234567','Other'],['CCCU1234567','APM']),2000);
  assert.deepEqual(second.added,['CCCU1234567']);assert.deepEqual(second.removed,['AAAU1234567']);
  const c=second.cache.containers;
  assert.equal(c.AAAU1234567.inLatestTemplate,false,'history stays');
  assert.equal(c.BBBU1234567.inLatestTemplate,true);assert.equal(c.BBBU1234567.templateTerminal,'Other');
  assert.equal(c.BBBU1234567.firstListedAt,new Date(1000).toISOString());
  assert.equal(second.cache.runs.length,2);assert.equal(second.cache.runs[1].searchedCount,2);
});
test('a cache file from the manual runs imports with its records intact',()=>{
  const file={schemaVersion:1,updatedAt:'2026-11-03T16:52:42.346Z',runs:[{id:'r1'}],positionRules:{Decked:['Deck','OWN']},
    containers:{BEAU5075123:{inLatestTemplate:true,lastObservedStatus:{lfd:'2026-10-29'},lastVerifiedApplied:{rowHint:214,lfd:'10/28',g:'Ground',h:'OWN'}}}};
  const {cache,count}=importCache(null,JSON.stringify(file));
  assert.equal(count,1);assert.equal(cache.containers.BEAU5075123.lastVerifiedApplied.lfd,'10/28');assert.equal(cache.runs[0].id,'r1');
  // The plugin's newer list keeps deciding which containers are on the list.
  const mine=mergeCache(emptyCache(),list(Date.parse('2026-11-04T00:00:00Z'),['CCCU1234567','APM']),Date.parse('2026-11-04T00:00:00Z')).cache;
  const merged=importCache(mine,JSON.stringify(file)).cache;
  assert.equal(merged.containers.BEAU5075123.inLatestTemplate,false);
  assert.equal(merged.containers.CCCU1234567.inLatestTemplate,true);
  assert.equal(merged.containers.BEAU5075123.lastVerifiedApplied.rowHint,214);
  assert.throws(()=>importCache(null,'{"schemaVersion":2}'),/查柜缓存/);
  assert.throws(()=>importCache(null,'nope'),/JSON/);
  assert.throws(()=>importCache(null,JSON.stringify({schemaVersion:1,containers:{bad:{}}})),/无效柜号/);
});
test('steps and bundled scripts are in place',()=>{
  assert.deepEqual(STEPS.map(s=>s[0]),['push','read','cache','draydog','track','status','baseline','plan','apply','verify','save']);
  const read=readFileSync(new URL('../public/airscript/TH_ReadV2.js',import.meta.url),'utf8');
  assert.match(read,/TH build:\s*\d+/);
  assert.doesNotMatch(read,/\.Value2\s*=|ClearContents|\.Delete\(|\.Insert\(|\.Cut\(/,'TH_ReadV2 must only read');
  const push=readFileSync(new URL('../public/airscript/ListA_Push.js',import.meta.url),'utf8');
  assert.match(push,/List A 已写入：/);
  const manifest=JSON.parse(readFileSync(new URL('../public/manifest.json',import.meta.url),'utf8'));
  assert.ok(manifest.host_permissions.includes('https://app.draydog.com/*'));
});
