import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translate,resolveLanguage,LANGUAGES} from '../src/core/i18n.ts';
import {STRINGS as MAIN_STRINGS} from '../src/core/i18n-strings.ts';
import {LAB_STRINGS} from '../src/core/i18n-labs.ts';
const STRINGS=[...MAIN_STRINGS,...LAB_STRINGS];
import {validateSettings,createConfig,parseConfig} from '../src/core/config.ts';

const CJK=/[\u3400-\u9fff]/;
test('without a choice the language follows the browser, and a choice wins',()=>{
  for(const [browser,expected] of [['zh-CN','zh'],['zh-TW','zh'],['ZH','zh'],['es-419','es'],['es','es'],['en-US','en'],['fr','en'],['','en'],[undefined,'en']])
    assert.equal(resolveLanguage('',browser),expected,String(browser));
  assert.equal(resolveLanguage('es','zh-CN'),'es');assert.equal(resolveLanguage('zh','en-US'),'zh');
  assert.deepEqual(Object.keys(LANGUAGES),['zh','en','es']);
});
test('every entry has both translations with matching placeholders',()=>{
  const keys=new Set();
  for(const [zh,en,es] of STRINGS){
    assert.ok(!keys.has(zh),`duplicate: ${zh}`);keys.add(zh);
    for(const text of [en,es]){
      assert.ok(typeof text==='string'&&text.length,zh);assert.ok(!CJK.test(text),`Chinese left in: ${text}`);
      const holes=(zh.match(/\{\}/g)||[]).length;
      assert.deepEqual([...new Set((text.match(/\{(\d)l?\}/g)||[]).map(hole=>hole[1]))].sort(),[...Array(holes).keys()].map(String),`placeholders: ${zh}`);
      assert.deepEqual((text.match(/\{\{\w+\}\}/g)||[]).sort(),(zh.match(/\{\{\w+\}\}/g)||[]).sort(),`template tokens: ${zh}`);
    }
  }
});
test('values are placed, translated when known and kept when not',()=>{
  assert.equal(translate('提柜表中找不到柜号 MSCU1234567，请检查柜号是否输入正确。','en'),'Container MSCU1234567 is not in the pickup sheet. Please check the number.');
  assert.equal(translate('请填写码头名称。','en'),'Please enter the terminal name.');
  assert.equal(translate('船公司名称','es'),'Nombre de la naviera');
  assert.equal(translate('未保存：邮箱地址格式无效：x@','en'),'Not saved: Invalid email address: x@');
  assert.equal(translate('发送邮件 · 3 个柜号','en'),'Send email · 3 containers');
  assert.equal(translate('Gmail 写信页中的收件人与配置不符（Cc 缺少 a@b.com）。','en'),'Recipients on the Gmail compose page do not match the settings (Cc is missing a@b.com).');
  assert.equal(translate('发送邮件','zh'),'发送邮件');assert.equal(translate('Maersk','en'),'Maersk');assert.equal(translate('',  'es'),'');
});
// Label matchers for the KDocs page, in its own languages: never shown.
const PAGE_LABELS=/高级开发|進階開發|高級開發|AirScript脚本编辑器|AirScript腳本編輯器|我的脚本|我的腳本|文档共享脚本|文檔共享腳本|文件共用腳本|^\^List A 已写入：$/;
const literal=/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
test('no message in the code stays in Chinese',()=>{
  for(const file of ['src/app/store.ts','src/app/Shell.vue','src/app/pages/QueryPage.vue','src/app/pages/TasksPage.vue','src/app/pages/HistoryPage.vue','src/app/pages/ConfigPage.vue','src/core/service.ts','src/core/core.ts','src/core/config.ts','src/background/worker.ts','src/injected/gmail.ts','src/injected/cosco.ts','src/injected/one.ts','src/injected/kdocs.ts','src/injected/airscript.ts','src/injected/draydog.ts','src/background/chagui.ts','src/core/chagui-rules.ts','src/app/labs.ts','src/app/pages/LabsPage.vue','src/background/matson.ts','src/core/matson-rules.ts','src/injected/matson.ts']){
    const source=readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/^\s*\/\/.*$/gm,'');
    for(const match of source.matchAll(literal)){
      const text=(match[1]??match[2]).replace(/\$\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g,'X').replaceAll("\\'","'").replaceAll('\\n','\n');
      if(!CJK.test(text)||PAGE_LABELS.test(text)||text.includes('`'))continue;
      for(const language of ['en','es'])assert.ok(!CJK.test(translate(text,language)),`${file} (${language}): ${text}\n→ ${translate(text,language)}`);
    }
  }
});
test('the language setting validates, round-trips and survives an old file',()=>{
  assert.equal(validateSettings().language,'');assert.equal(validateSettings({language:'es'}).language,'es');
  assert.throws(()=>validateSettings({language:'fr'}),/语言/);
  const current=validateSettings({language:'en'});
  assert.equal(parseConfig(JSON.stringify(createConfig(current))).language,'en');
  assert.equal(parseConfig(JSON.stringify({format:'lfd-inquiry-config',version:1,settings:{}}),current).language,'en');
});
test('the popup uses in-app dialogs: native ones stop working when the user blocks them',()=>{
  for(const file of ['src/app/store.ts','src/app/Shell.vue','src/app/pages/QueryPage.vue','src/app/pages/TasksPage.vue','src/app/pages/HistoryPage.vue','src/app/pages/ConfigPage.vue']){
    const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\b(window\.)?(alert|confirm|prompt)\(/,file);
  }
});
