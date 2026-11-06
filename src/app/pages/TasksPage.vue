<script setup lang="ts">
import {computed,onMounted} from 'vue';
import {NButton} from 'naive-ui';
import {deleteTask,markSent,openDraft,openMailto,refillLookup,resendTask,stopTask,t,taskGroups,taskView,verifySent} from '../store.ts';
import {oocl,loadOocl,watchOocl,applyPreviewOocl,dismissOocl,ooclWriting} from '../oocl.ts';

const sections=computed(()=>[
  {heading:`进行中（${taskGroups.value.running.length}）`,groups:taskGroups.value.running},
  {heading:`需要处理（${taskGroups.value.attention.length}）`,groups:taskGroups.value.attention}
].filter(section=>section.groups.length));
// OOCL Demurrage LFD run (src/app/oocl.ts), started from the query page: steps, then per container OOCL's,
// Draydog's and the earlier date, and what the 提柜表 gets.
const stateLabel={waiting:'等待',running:'进行中',done:'完成',error:'失败'};
const ooclRunning=computed(()=>oocl.run?.status==='running');
const canWriteOocl=computed(()=>{const r=oocl.run;return Boolean(r&&r.status==='done'&&!r.apply&&r.plan&&(r.plan.changes.length||r.plan.notes.length));});
const mmdd=(iso:string)=>iso?iso.slice(5).replace('-','/'):'';
const timeText=(ms:number)=>ms?new Date(ms).toLocaleTimeString():'';
// The card's head reads like the other task rows: containers (MBL small), then carrier · type · start time, then
// where it stands and what to do next.
const ooclHead=computed(()=>{
  const r=oocl.run;if(!r)return null;
  const minutes=Math.max(0,Math.round(((r.status==='running'?Date.now():r.finishedAt||Date.now())-(r.startedAt||Date.now()))/60000));
  const detail=`${r.carrierName||'OOCL'} · ${r.typeLabel||'Demurrage'} · ${timeText(r.startedAt)} 开始${r.status==='running'?` · 已 ${minutes} 分钟`:''}`;
  const current=r.steps.find(s=>s.status==='running');
  const steps=r.fromPreview?'按上次仅查询的结果写入':r.apply?`查询并更新，共 ${r.steps.length} 步`:`仅查询，共 ${r.steps.length} 步（不写 Draydog、不写提柜表）`;
  const pending=canWriteOocl.value;
  const step=r.status==='running'?`${current?current.label:'进行中'}`
    :r.status==='error'?`查询失败：${r.error||'请看下面失败的那一步'}`
    :pending?'已查询，还没写入；下一步：核对下面的结果后点「写入数据」'
    :'已查询，LFD 已确定，已归档到「记录」';
  return {detail,steps,step,items:r.items||[]};
});
const retryOocl=()=>refillLookup((oocl.run?.items||[]).map((i:any)=>i.container));
// Long values such as "Line_H,Not_Ready_For_Pickup_H" may wrap after each comma rather than mid-word.
const breakable=(text:unknown)=>String(text??'').replace(/,/g,',​');
onMounted(()=>{loadOocl();watchOocl();});
</script>

<template>
  <div class="section-top"><h2>{{t('进行中的任务')}}</h2></div>
  <div id="tasks">
    <p v-if="!taskGroups.all.length&&!oocl.run" class="empty">{{t('没有进行中的任务')}}</p>
    <div v-if="oocl.run" id="ooclRun" class="group-card oocl-run">
      <div class="task-row oocl-head">
        <div>
          <strong class="task-names"><template v-for="(item,i) in ooclHead.items" :key="item.container">{{i?'、':''}}{{item.container}}<span v-if="item.mbl" class="task-mbl">{{item.mbl}}</span></template></strong>
          <p>{{t(ooclHead.detail)}} · {{t(ooclHead.steps)}}</p>
          <div class="task-step" :class="{interrupted:oocl.run.status==='error'}">{{t(ooclHead.step)}}</div>
        </div>
        <div class="history-buttons">
          <template v-if="!ooclRunning">
            <n-button v-if="canWriteOocl" id="ooclApplyPreview" type="primary" size="tiny" :loading="ooclWriting" :disabled="ooclWriting" @click="applyPreviewOocl">{{t('写入数据')}}</n-button>
            <template v-else>
              <n-button v-if="oocl.run.status==='error'" size="tiny" @click="retryOocl">{{t('重新查询')}}</n-button>
              <n-button size="tiny" @click="dismissOocl">{{t('关闭')}}</n-button>
            </template>
          </template>
        </div>
      </div>
      <ol class="labs-steps">
        <li v-for="step in oocl.run.steps" :key="step.key" :class="step.status">
          <span class="labs-state">{{t(stateLabel[step.status]||step.status)}}</span>
          <span>{{t(step.label)}}</span>
          <p v-if="step.detail">{{t(step.detail)}}</p>
        </li>
      </ol>
      <table v-if="oocl.run.plan?.results?.length" class="container-table oocl-table">
        <tr><th class="oocl-nowrap">{{t('柜号')}}</th><th class="oocl-nowrap">{{t('码头')}}</th><th class="oocl-value">{{t('状态')}}</th><th class="oocl-nowrap">SSL</th><th class="oocl-nowrap">Draydog</th><th class="oocl-nowrap">LFD</th><th class="oocl-nowrap">{{t('提柜表更新')}}</th></tr>
        <tr v-for="r in oocl.run.plan.results" :key="r.container">
          <td class="mono oocl-nowrap">{{r.container}}</td>
          <td class="oocl-nowrap">{{r.terminal}}</td>
          <td class="oocl-value">{{breakable(r.status)}}</td>
          <td class="oocl-nowrap">{{mmdd(r.ooclLfd)}}</td>
          <td class="oocl-nowrap">{{mmdd(r.draydogLfd)}}</td>
          <td class="oocl-nowrap"><b>{{mmdd(r.lfd)}}</b></td>
          <td class="oocl-nowrap"><template v-if="r.row"><template v-if="r.before===r.after">{{t('不用改')}}</template><template v-else>{{r.before||'—'}} <span class="oocl-arrow">→</span> {{r.after}}</template></template></td>
        </tr>
      </table>
      <p v-for="item in oocl.run.plan?.skipped||[]" :key="item.container+item.reason" class="hint labs-skip">{{item.container}}<template v-if="item.mbl"> ({{item.mbl}})</template>：{{t(item.reason)}}</p>
      <p v-if="canWriteOocl" class="hint">{{t('「写入数据」直接写入上面这些改动（Draydog SSL LFD 和提柜表 K 列），不再重新查询。')}}</p>
    </div>
    <template v-for="section in sections" :key="section.heading">
      <h3 class="task-heading">{{t(section.heading)}}</h3>
      <div v-for="group in section.groups" :key="group[0].requestId||group[0].container" class="task-row">
        <template v-for="task in [taskView(group)]" :key="task.names">
          <div>
            <strong class="task-names"><template v-for="(item,i) in task.items" :key="item.container">{{i?'、':''}}{{item.container}}<span v-if="item.mbl" class="task-mbl">{{item.mbl}}</span></template></strong>
            <p>{{t(task.detail)}}</p>
            <div class="task-step" :class="{interrupted:!task.entry.running}">{{t(task.step)}}</div>
          </div>
          <div class="history-buttons">
            <n-button v-if="Number.isInteger(task.entry.tabId)" size="tiny" @click="openDraft(task.entry.tabId)">{{t(task.openLabel)}}</n-button>
            <n-button v-if="task.entry.running" size="tiny" type="error" ghost @click="stopTask(task)">{{t('终止')}}</n-button>
            <template v-else>
              <template v-if="task.system">
                <n-button size="tiny" @click="openMailto(task.entry.mailto)">{{t('重新打开邮件')}}</n-button>
                <n-button size="tiny" @click="markSent(task.entry.requestId)">{{t('我已发送')}}</n-button>
              </template>
              <n-button v-if="task.canVerify" size="tiny" :title="t('在对应页面确认消息/邮件确实已经发出后点击，记录改为已发送并保持防重复锁')" @click="verifySent(task)">{{t('我已核实已发送')}}</n-button>
              <n-button size="tiny" @click="resendTask(task,group)">{{t('重新发送')}}</n-button>
              <n-button size="tiny" @click="deleteTask(task)">{{t('删除')}}</n-button>
            </template>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
