<script setup lang="ts">
import {computed,onMounted} from 'vue';
import {NButton,NInput,NSelect,NTag} from 'naive-ui';
import {oocl,loadOocl,watchOocl,applyPreviewOocl,dismissOocl,ooclWriting} from '../oocl.ts';
import {canEditMail,discardEdit,editOf,finishEdit,startEdit} from '../store.ts';
import {busy,channelName,configureCarrier,containersInput,entryNote,groupLabels,groups,kind,lookup,moveGroup,pendingCount,previewOf,profileChoices,query,recordLabel,removeEntry,resendLocked,sendAll,sendGroup,sendAllLabel,sending,setManualMbl,setOverride,t,totals,typeOptions,chooseType,unresolved} from '../store.ts';

const missingNames={carrier:'船公司配置',type:'查询类型',to:'收件邮箱',requester:'工单 Requester',reference:'PD INV /BL /BKG /HOU # /SCAC Code',bodyTemplate:'正文模板',subjectTemplate:'主题模板'};
// Kept out of the template: its {{table}} would end the template's own {{ }}.
const editHint='{{table}} 处会放入柜号表格。这里的修改只用于这一次发送，不会改动配置里的模板。';
const chatEditHint='每个柜号一行消息，顺序和上面的柜号一致。这里的修改只用于这一次发送，不会改动配置里的模板。';
const missingText=group=>group.missing.map(key=>t(missingNames[key]||key)).join(' · ');
// OOCL Demurrage LFD run (src/app/oocl.ts): steps, then per container OOCL's, Draydog's and the earlier date.
const stateLabel={waiting:'等待',running:'进行中',done:'完成',error:'失败'};
const running=computed(()=>oocl.run?.status==='running');
const runLabel=computed(()=>({running:'OOCL 查询进行中',done:'OOCL 查询完成',error:'OOCL 查询失败'}[oocl.run?.status]||''));
const canWriteOocl=computed(()=>{const r=oocl.run;return Boolean(r&&r.status==='done'&&!r.apply&&r.plan&&(r.plan.changes.length||r.plan.notes.length));});
const mmdd=(iso:string)=>iso?iso.slice(5).replace('-','/'):'';
const timeText=(ms:number)=>ms?new Date(ms).toLocaleTimeString():'';
onMounted(()=>{loadOocl();watchOocl();});
</script>

<template>
  <div class="query-layout">
    <section class="query-controls">
      <label class="field-label" for="containers">{{t('柜号')}}</label>
      <n-input id="containersBox" type="textarea" :value="query.text" :input-props="{id:'containers',spellcheck:false,autocomplete:'off'}" :autosize="{minRows:4,maxRows:10}" :placeholder="t('粘贴一个或多个柜号')" @update:value="containersInput"/>
      <label class="field-label">{{t('查询类型')}}</label>
      <n-select id="inquiryType" size="small" :value="query.inquiryType" :options="typeOptions" @update:value="chooseType"/>
      <div class="send-all">
        <n-button id="sendAll" type="primary" block :disabled="busy||!totals.containers||pendingCount>0" @click="sendAll('send')">{{t(sendAllLabel)}}</n-button>
        <n-button id="draftAll" block :disabled="busy||!totals.containers||pendingCount>0" @click="sendAll('draft')">{{t('全部仅生成草稿')}}</n-button>
      </div>
    </section>

    <section class="query-groups">
      <p v-if="!groups.length&&!unresolved.length&&!pendingCount" class="empty-preview">{{t('粘贴柜号后，这里按船公司分组显示。')}}</p>
      <p v-if="pendingCount" class="hint">{{t(`正在查询 ${pendingCount} 个柜号…`)}}</p>

      <div v-if="unresolved.length" id="unresolved" class="group-card attention">
        <div class="group-head"><strong>{{t(`需要处理（${unresolved.length}）`)}}</strong><span class="hint">{{t('补全后会自动归入对应分组')}}</span></div>
        <div v-for="entry in unresolved" :key="entry.key" class="fix-row">
          <span class="mono">{{entry.container}}</span>
          <n-input size="small" :value="entry.manualMbl||entry.mbl" :placeholder="t('MBL')" @update:value="value=>setManualMbl(entry,value)"/>
          <n-select size="small" filterable :value="entry.override||entry.carrierId||null" :options="profileChoices" :placeholder="t(kind)" @update:value="value=>setOverride(entry,value)"/>
          <n-button size="tiny" quaternary type="error" :title="t('移除这个柜号')" @click="removeEntry(entry)">×</n-button>
          <span class="fix-note">{{t(entryNote(entry))}} <n-button v-if="entry.state==='notfound'||entry.state==='error'" text size="tiny" type="primary" @click="lookup(entry,true)">{{t('重新查找')}}</n-button></span>
        </div>
      </div>

      <div v-if="oocl.run" id="ooclRun" class="group-card oocl-run">
        <div class="group-head">
          <strong>{{t('OOCL Demurrage LFD')}}</strong>
          <span class="hint">{{t(runLabel)}}<template v-if="!oocl.run.apply"> · {{t('预览')}}</template> · {{timeText(oocl.run.startedAt)}}</span>
          <n-button v-if="!running" class="row-remove" size="tiny" quaternary :title="t('关闭')" @click="dismissOocl">×</n-button>
        </div>
        <ol class="labs-steps">
          <li v-for="step in oocl.run.steps" :key="step.key" :class="step.status">
            <span class="labs-state">{{t(stateLabel[step.status]||step.status)}}</span>
            <span>{{t(step.label)}}</span>
            <p v-if="step.detail">{{t(step.detail)}}</p>
          </li>
        </ol>
        <table v-if="oocl.run.plan?.results?.length" class="container-table oocl-table">
          <tr><th>{{t('柜号')}}</th><th>MBL</th><th>{{t('OOCL 状态')}}</th><th>SSL LFD</th><th>{{t('Draydog LFD')}}</th><th>LFD</th><th>K</th><th>Draydog note</th></tr>
          <tr v-for="r in oocl.run.plan.results" :key="r.container">
            <td class="mono">{{r.container}}</td><td class="mono">{{r.mbl}}</td><td>{{r.status}}</td><td>{{mmdd(r.ooclLfd)}}</td>
            <td>{{mmdd(r.draydogLfd)}}<span v-if="r.terminal" class="hint"> {{r.terminal}}</span></td>
            <td><b>{{mmdd(r.lfd)}}</b></td>
            <td>{{r.row?(r.before===r.after?t('不用改'):`${r.before||'—'} → ${r.after}`):''}}</td>
            <td>{{t(r.note)}}</td>
          </tr>
        </table>
        <p v-for="item in oocl.run.plan?.skipped||[]" :key="item.container+item.reason" class="hint labs-skip">{{item.container}}<template v-if="item.mbl"> ({{item.mbl}})</template>：{{t(item.reason)}}</p>
        <div v-if="canWriteOocl" class="group-actions">
          <n-button id="ooclApplyPreview" type="primary" size="small" :loading="ooclWriting" :disabled="ooclWriting||running" @click="applyPreviewOocl">{{t('按这次结果更新')}}</n-button>
          <span class="hint">{{t('直接写入上面这些改动，不再重新查询。')}}</span>
        </div>
      </div>

      <div v-for="(group,index) in groups" :key="group.id" class="group-card" :data-carrier="group.id">
        <div class="group-head">
          <n-select class="group-carrier" size="small" filterable :value="group.id" :options="profileChoices" :consistent-menu-width="false" @update:value="value=>moveGroup(group,value)"/>
          <n-tag size="small" :bordered="false">{{t(channelName(group))}}</n-tag>
          <span v-if="group.typeLabel" class="hint">{{group.typeLabel}}</span>
          <span class="group-count">{{t(`${group.rows.length} 个柜号`)}}</span>
        </div>
        <p v-if="group.recipients" class="recipients">{{t(group.recipients)}}</p>
        <table class="container-table">
          <tr v-for="row in group.rows" :key="row.entry.key" :class="{locked:row.lock}">
            <td class="mono">{{row.entry.container}}</td>
            <td class="mono">{{row.entry.manualMbl||row.entry.mbl}}</td>
            <td class="row-state">
              <template v-if="row.lock">{{t('已有记录')}} · {{t(recordLabel(row.lock.status))}} <n-button class="resend-locked" text size="tiny" type="warning" :title="t('解除锁定后再次发送')" @click="resendLocked(row)">{{t('仍要发送')}}</n-button></template>
              <template v-else>{{t('已匹配')}}</template>
            </td>
            <td class="row-remove"><n-button size="tiny" quaternary type="error" :title="t('移除这个柜号')" @click="removeEntry(row.entry)">×</n-button></td>
          </tr>
        </table>
        <div v-if="group.needsAccount" class="notice missing"><span>{{t('还需要配置：')}}</span><strong>{{t('OOCL 账号')}}</strong><n-button size="tiny" @click="configureCarrier(group)">{{t('配置 OOCL')}}</n-button></div>
        <p v-if="group.channel==='oocl-rtr'" class="hint">{{t('按提单号在 OOCL 网站查 Demurrage LFD；「查询并更新」会给 Draydog 加 SSL LFD note，并把 OOCL 与 Draydog 中较早的 LFD 写入提柜表 K 列。')}}</p>
        <div v-if="group.missing.length" class="notice missing"><span>{{t('还需要配置：')}}</span><strong>{{missingText(group)}}</strong><n-button size="tiny" @click="configureCarrier(group)">{{t(group.profile?`配置 ${group.name}`:`新增或选择${kind}`)}}</n-button></div>
        <p v-if="group.channel==='cosco-portal'&&!group.many&&group.ready.length>1" class="hint">{{t('逐个提交，每张需人机验证')}}</p>
        <details v-if="previewOf(group)" class="group-preview" :open="groups.length===1&&!unresolved.length">
          <summary>{{t('预览')}}<span v-if="editOf(group)" class="edited-mark">{{t('已临时修改 · 仅本次发送')}}</span></summary>
          <template v-for="preview in [previewOf(group)]" :key="group.id+'p'">
            <div v-if="canEditMail(group)&&!editOf(group)?.editing" class="preview-tools">
              <n-button text size="tiny" class="edit-mail" :title="t(group.channel==='email'?'只修改这一次发送的邮件，不会改动配置里的模板':'只修改这一次发送的正文，不会改动配置里的模板')" @click="startEdit(group)">✎ {{t('编辑')}}</n-button>
              <n-button v-if="editOf(group)" text size="tiny" class="edit-mail" @click="discardEdit(group)">{{t('恢复模板')}}</n-button>
            </div>
            <form v-if="editOf(group)?.editing" class="mail-edit" @submit.prevent="finishEdit(group)">
              <template v-for="edit in [editOf(group)]" :key="group.id+'e'">
                <template v-if="edit.mailOnly">
                  <label class="field-label">To</label><n-input size="small" v-model:value="edit.to" :input-props="{autocomplete:'off',spellcheck:false}" :placeholder="t('多个邮箱用逗号分隔')"/>
                  <label class="field-label">Cc</label><n-input size="small" v-model:value="edit.cc" :input-props="{autocomplete:'off',spellcheck:false}" :placeholder="t('多个邮箱用逗号分隔')"/>
                  <label class="field-label">{{t('主题')}}</label><n-input size="small" v-model:value="edit.subject" placeholder=""/>
                </template>
                <label class="field-label">{{t('正文')}}</label><n-input type="textarea" size="small" v-model:value="edit.body" :autosize="{minRows:group.channel==='one-chat'?2:5,maxRows:16}" placeholder=""/>
                <p class="hint">{{t(group.channel==='one-chat'?chatEditHint:editHint)}}</p>
                <div class="edit-actions">
                  <n-button size="tiny" quaternary @click="discardEdit(group)">{{t('恢复模板')}}</n-button>
                  <n-button size="tiny" attr-type="submit">{{t('完成')}}</n-button>
                </div>
              </template>
            </form>
            <p v-else-if="preview.error" class="notice">{{t(preview.error)}}</p>
            <template v-else>
              <dl>
                <dt>To</dt><dd>{{preview.to}}</dd>
                <template v-if="preview.cc"><dt>Cc</dt><dd>{{preview.cc}}</dd></template>
                <template v-if="preview.subject"><dt>{{t('主题')}}</dt><dd class="subject">{{preview.subject}}</dd></template>
              </dl>
              <p v-if="preview.note" class="hint">{{t(preview.note)}}</p>
              <div class="mail-body"><div v-if="preview.html" v-html="preview.html"></div><p v-for="line in preview.lines" :key="line">{{line}}</p></div>
            </template>
          </template>
        </details>
        <div class="group-actions">
          <n-button class="group-send" size="small" type="primary" :loading="sending[group.id]" :disabled="busy||!group.ready.length" @click="sendGroup(group,'send')">{{t(groupLabels(group).send)}}</n-button>
          <n-button v-if="groupLabels(group).draft" class="group-draft" size="small" :disabled="busy||!group.ready.length" @click="sendGroup(group,'draft')">{{t(groupLabels(group).draft)}}</n-button>
        </div>
      </div>
    </section>
  </div>
</template>
