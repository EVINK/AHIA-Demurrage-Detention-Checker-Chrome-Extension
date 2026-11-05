<script setup lang="ts">
import {computed,onMounted} from 'vue';
import {NButton,NCheckbox,NInput,NRadio,NRadioGroup,NSelect} from 'naive-ui';
import {flushSave,form,isOpen,setOpen,t} from '../store.ts';
import {addHoldRule,answerHolds,answerRows,rowChoices,markAllPickable,applyPreviewChagui,chagui,downloadAirScript,duration,editHoldRule,exportChaguiCache,holdAnswers,holdDraft,holdKey,holdRules,importChaguiCache,importing,importText,loadChagui,loadHoldRules,removeHoldRule,retryChagui,startChagui,starting,stopChagui,suggestWord,timeText,watchChagui} from '../labs.ts';

const running=computed(()=>['running','waiting'].includes(chagui.run?.status));
// The write button under a finished preview that has changes (the worker also refuses a stale one).
const canWritePreview=computed(()=>{const r=chagui.run;return Boolean(r&&r.status==='done'&&!r.apply&&r.plan&&(r.plan.changes.length||r.plan.moves.length));});
const pending=computed(()=>chagui.run?.status==='waiting'?chagui.run.pending?.holds||[]:[]);
const pendingRows=computed(()=>chagui.run?.status==='waiting'?chagui.run.pending?.rows||[]:[]);
// Each new word starts as "a hold", with a suggested B column word the owner can change.
const answer=(u:any)=>holdAnswers[holdKey(u)]||(holdAnswers[holdKey(u)]={hold:true,word:suggestWord(u)});
const byOptions=[{value:'text',label:'Draydog 原文'},{value:'type',label:'Draydog 类型'},{value:'tag',label:'Draydog 标签'},{value:'label',label:'Draydog 标记'}];
const byLabel=(by:string)=>({type:'Draydog 类型',tag:'Draydog 标签',label:'Draydog 标记'} as any)[by]||'Draydog 原文';
const stateLabel={waiting:'等待',running:'进行中',done:'完成',error:'失败'};
const runLabel=computed(()=>({running:'查柜进行中',waiting:'查柜暂停：等你处理新的 Hold 词',done:'上次查柜完成',error:'上次查柜失败'}[chagui.run?.status]||''));
// One table entry per container: its cells, plus where its row moves: old row, ↓, new row on three lines (the A move with no cell
// arrow always points down, whichever way the row goes). A move with no cell change still gets a line; a move that
// did not happen in a write run shows only its row.
const planRows=computed(()=>{
  const plan=chagui.run?.plan;if(!plan)return [];
  const moves=new Map(plan.moves.map((m:any)=>[m.container,m]));
  const rowText=(container:string,row:number)=>{const m:any=moves.get(container);return m?.to?`${m.from}\n↓\n${m.to}`:String(row);};
  const items=plan.changes.map((c:any)=>({container:c.container,cells:c.cells,move:moves.get(c.container),rowText:rowText(c.container,c.row)}));
  for(const m of plan.moves)if(!plan.changes.some((c:any)=>c.container===m.container))items.push({container:m.container,cells:[{col:'—',beforeText:'',afterText:''}],move:m,rowText:rowText(m.container,m.from)});
  return items;
});
const scripts=['ListA_Push.js','TH_ReadV2.js','TH_ReadPickup.js','TH_Apply.js'];
onMounted(()=>{loadChagui();watchChagui();loadHoldRules();});
</script>

<template>
  <div class="section-top"><h2>{{t('实验性功能')}}</h2></div>
  <div id="labs" class="labs">
    <!-- Feature 1: 查柜. Everything that belongs to it (cache, keywords, scripts) sits inside this card. -->
    <section id="chaguiFeature" class="labs-feature">
      <div class="section-top labs-feature-head">
        <div>
          <h3>{{t('查柜')}}</h3>
          <p class="hint">{{t('更新名单，从 Draydog 读取状态，列出 Appointed / Bookable，按规则更新提柜表并复核。预览只计算要改什么，不写表。')}}</p>
        </div>
        <div class="history-buttons">
          <n-button id="chaguiPreview" :loading="(starting||running)&&!chagui.run?.apply" :disabled="starting||running" @click="startChagui(false)">{{t('预览')}}</n-button>
          <n-button id="chaguiApply" type="primary" :loading="(starting||running)&&chagui.run?.apply" :disabled="starting||running" @click="startChagui(true)">{{t('查柜并写表')}}</n-button>
        </div>
      </div>
      <template v-if="chagui.run">
        <div class="labs-run" :class="chagui.run.status">
          {{t(runLabel)}}<template v-if="!chagui.run.apply"> · {{t('预览')}}</template> · {{timeText(chagui.run.startedAt)}}<template v-if="duration(chagui.run)"> · {{t(duration(chagui.run))}}</template>
        </div>
        <ol class="labs-steps">
          <li v-for="step in chagui.run.steps" :key="step.key" :class="step.status">
            <span class="labs-state">{{t(stateLabel[step.status]||step.status)}}</span>
            <span>{{t(step.label)}}</span>
            <p v-if="step.detail">{{t(step.detail)}}</p>
            <n-button v-if="step.status==='error'&&chagui.run.status==='error'" class="labs-retry" size="tiny" :disabled="starting||running" @click="retryChagui">{{t('重试')}}</n-button>
          </li>
        </ol>
        <div v-if="pendingRows.length" id="pendingRows" class="labs-pending">
          <strong>{{t('这些柜号在提柜表里有多行，请选择要更新的那一行：')}}</strong>
          <div v-for="d in pendingRows" :key="d.container" class="labs-pending-row">
            <b>{{d.container}}</b>
            <n-radio-group size="small" :value="rowChoices[d.container]" @update:value="v=>rowChoices[d.container]=v">
              <div v-for="r in d.rows" :key="r.row" class="labs-row-choice">
                <n-radio :value="r.row">{{t(`第 ${r.row} 行`)}}</n-radio>
                <span class="hint">{{[r.A,r.B,r.C,r.P,r.G,r.H,r.K&&('LFD '+r.K),r.M&&(r.M+' '+r.N)].filter(Boolean).join(' · ')||t('（其他列为空）')}}</span>
              </div>
              <div class="labs-row-choice"><n-radio :value="0">{{t('这次跳过这个柜号')}}</n-radio></div>
            </n-radio-group>
          </div>
          <div class="history-buttons labs-buttons">
            <n-button id="answerRows" type="primary" size="small" @click="answerRows">{{t('保存并继续')}}</n-button>
            <n-button size="small" @click="stopChagui">{{t('暂停任务')}}</n-button>
          </div>
        </div>        <div v-if="pending.length" id="pendingHolds" class="labs-pending">
          <strong>{{t('Draydog 出现了关键词里没有的词，请选择怎么处理：')}}</strong>
          <div v-for="u in pending" :key="holdKey(u)" class="labs-pending-row">
            <div><b>{{u.text||u.type}}</b><span v-if="u.source" class="hint"> （{{t(byLabel(u.source))}}）</span><span v-else-if="u.type&&u.text" class="hint"> （{{u.type}}）</span><p class="hint">{{u.containers.join('、')}}</p></div>
            <n-radio-group size="small" :value="answer(u).hold?'hold':'ignore'" @update:value="v=>answer(u).hold=v==='hold'">
              <n-radio value="hold">{{t('不可提（添加关键词），B 列写')}}</n-radio>
              <n-radio value="ignore">{{t('可提（忽略）')}}</n-radio>
            </n-radio-group>
            <n-input v-if="answer(u).hold" v-model:value="answer(u).word" size="small" class="labs-word"/>
          </div>
          <div class="history-buttons labs-buttons">
            <n-button id="answerHolds" type="primary" size="small" @click="answerHolds">{{t('保存并继续')}}</n-button>
            <n-button v-if="pending.length>1" size="small" @click="markAllPickable">{{t('全部选可提')}}</n-button>
            <n-button size="small" @click="stopChagui">{{t('暂停任务')}}</n-button>
          </div>
        </div>
        <details v-if="chagui.run.plan" class="labs-sub labs-plan" :open="!chagui.run.apply">
          <summary>{{t(chagui.run.apply?'本轮改动':'预览：将要做的改动')}}</summary>
          <table v-if="planRows.length">
            <tr><th>{{t('柜号')}}</th><th>{{t('行')}}</th><th>{{t('列')}}</th><th>{{t('原值')}}</th><th>{{t('新值')}}</th></tr>
            <template v-for="item in planRows" :key="item.container">
              <tr v-for="(cell,i) in item.cells" :key="cell.col"><td>{{i?'':item.container}}</td><td class="labs-row labs-moved" :title="i||!item.move?'':t(`移到按码头排（${item.move.terminal}）`)">{{i?'':item.rowText}}</td><td>{{cell.col}}</td><td>{{cell.beforeText}}</td><td>{{cell.afterText}}</td></tr>
            </template>
          </table>
          <p v-else class="hint">{{t('没有需要修改的')}}</p>
          <p v-for="item in chagui.run.plan.skipped" :key="item.container+item.reason" class="hint labs-skip">{{item.container}}：{{t(item.reason)}}</p>
          <div v-if="canWritePreview" class="history-buttons labs-buttons">
            <n-button id="applyPreview" type="primary" size="small" :disabled="starting||running" @click="applyPreviewChagui">{{t('按预览写入')}}</n-button>
            <span class="hint">{{t('直接写入上面这些改动，不再重新查询。')}}</span>
          </div>
        </details>
      </template>
      <details v-if="chagui.cache?.ready?.length" class="labs-sub labs-plan" open>
        <summary>{{t('Appointed / Bookable')}}（{{chagui.cache.ready.length}}）</summary>
        <table>
          <tr><th>{{t('柜号')}}</th><th>{{t('状态')}}</th><th>{{t('码头')}}</th><th>Hold</th><th>LFD</th><th>{{t('预约')}}</th><th>{{t('摆置')}}</th></tr>
          <tr v-for="item in chagui.cache.ready" :key="item.container">
            <td>{{item.container}}</td><td>{{item.category}}</td><td>{{item.terminal}}</td><td>{{item.holds}}</td>
            <td>{{item.lfd}}<template v-if="item.lineLfd"> / SSL {{item.lineLfd}}</template></td><td>{{item.appointment}}</td><td>{{item.position}}</td>
          </tr>
        </table>
      </details>
      <details id="holdRules" class="labs-sub labs-plan" :open="isOpen('holdRules')" @toggle="setOpen('holdRules',($event.target as HTMLDetailsElement).open)">
        <summary>{{t('Hold 关键词')}}（{{holdRules.length}}）</summary>
        <p class="hint">{{t('Draydog 显示的 Hold 先按原文找，再按类型找，对应到提柜表 B 列的写法；B 列留空表示不是 Hold。遇到列表里没有的词，查柜会暂停并通知你。')}}</p>
        <table>
          <tr><th>{{t('Draydog 显示')}}</th><th>{{t('匹配方式')}}</th><th>{{t('B 列写法')}}</th><th></th></tr>
          <tr v-for="(rule,i) in holdRules" :key="rule.by+rule.match">
            <td>{{rule.match}}</td><td>{{t(byLabel(rule.by))}}</td>
            <td><n-input size="tiny" :value="rule.word" :placeholder="t('不是 Hold')" @change="v=>editHoldRule(i,v)"/></td>
            <td><n-button size="tiny" quaternary type="error" @click="removeHoldRule(i)">{{t('删除')}}</n-button></td>
          </tr>
          <tr>
            <td><n-input v-model:value="holdDraft.match" size="tiny" :placeholder="t('例如 Hold Placed on the BL')"/></td>
            <td><n-select v-model:value="holdDraft.by" size="tiny" :options="byOptions.map(o=>({...o,label:t(o.label)}))"/></td>
            <td><n-input v-model:value="holdDraft.word" size="tiny" :placeholder="t('不是 Hold')"/></td>
            <td><n-button size="tiny" @click="addHoldRule">{{t('添加')}}</n-button></td>
          </tr>
        </table>
      </details>
      <details class="labs-sub">
        <summary>{{t('缓存')}}<template v-if="chagui.cache"> · {{timeText(chagui.cache.readAt)}}</template></summary>
        <template v-if="chagui.cache">
          <p class="hint">{{t(chagui.cache.stamp)}}</p>
          <p class="hint">{{t(`本次名单 ${chagui.cache.count} 柜，历史记录 ${chagui.cache.known} 柜（已核验 ${chagui.cache.verified}），${chagui.cache.runs} 轮记录`)}}</p>
          <div class="labs-terminals">
            <span v-for="[terminal,count] in chagui.cache.byTerminal" :key="terminal">{{terminal}} <b>{{count}}</b></span>
          </div>
          <details>
            <summary>{{t('柜号列表')}}（{{chagui.cache.count}}）</summary>
            <pre class="labs-list">{{chagui.cache.containers.map(c=>c.container+'  '+c.terminal).join('\n')}}</pre>
          </details>
        </template>
        <p class="hint">{{t('粘贴之前查柜留下的缓存 JSON（schemaVersion 1），每柜的状态、核验记录和审计记录会一起接过来。')}}</p>
        <n-input v-model:value="importText" type="textarea" size="small" :rows="3" :placeholder="t('粘贴缓存 JSON')"/>
        <div class="history-buttons labs-buttons">
          <n-button size="small" type="primary" :disabled="!importText.trim()||importing||running" :loading="importing" @click="importChaguiCache">{{t('导入缓存')}}</n-button>
          <n-button size="small" @click="exportChaguiCache">{{t('导出缓存')}}</n-button>
        </div>
      </details>
      <details class="labs-sub">
        <summary>{{t('脚本')}}</summary>
        <p class="hint">{{t('ListA_Push 在提柜表的“文档共享脚本”里运行，插件也存了一份。TH_ReadV2、TH_ReadPickup 只读，TH_Apply 写表，都会自动装进“我的脚本”。')}}</p>
        <div class="history-buttons labs-buttons">
          <n-button v-for="file in scripts" :key="file" size="small" @click="downloadAirScript(file)">{{t('下载')}} {{file.replace('.js','')}}</n-button>
        </div>
      </details>
    </section>
    <!-- Feature 2: Auto CC. -->
    <section id="autoCcSection" class="labs-feature">
      <div class="labs-feature-head">
        <h3>{{t('Gmail 自动抄送（Auto CC）')}}</h3>
        <p class="hint">{{t('发件人在名单内时，写信和回复自动加上抄送；其他发件人不受影响。')}}</p>
      </div>
      <form id="autoCcForm" @submit.prevent="flushSave">
        <n-checkbox id="autoCcEnabled" class="check" v-model:checked="form.autoCcEnabled">{{t('开启 Auto CC')}}</n-checkbox>
        <label class="field-label" for="autoCcSenders">{{t('发件人')}}</label><n-input v-model:value="form.autoCcSenders" :input-props="{id:'autoCcSenders',autocomplete:'off'}" :placeholder="t('多个邮箱用逗号分隔')"/>
        <label class="field-label" for="autoCcCc">{{t('抄送对象')}}</label><n-input v-model:value="form.autoCcCc" :input-props="{id:'autoCcCc',autocomplete:'off'}" :placeholder="t('多个邮箱用逗号分隔')"/>
      </form>
    </section>
  </div>
</template>
