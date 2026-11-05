<script setup lang="ts">
import {NButton,NInput,NSelect,NTag} from 'naive-ui';
import {canEditMail,discardEdit,editOf,finishEdit,startEdit} from '../store.ts';
import {busy,channelName,configureCarrier,containersInput,entryNote,groupLabels,groups,kind,lookup,moveGroup,pendingCount,previewOf,profileChoices,query,recordLabel,removeEntry,resendLocked,sendAll,sendGroup,sendAllLabel,sending,setManualMbl,setOverride,t,totals,typeOptions,chooseType,unresolved} from '../store.ts';

const missingNames={carrier:'船公司配置',type:'查询类型',to:'收件邮箱',requester:'工单 Requester',reference:'PD INV /BL /BKG /HOU # /SCAC Code',bodyTemplate:'正文模板',subjectTemplate:'主题模板'};
// Kept out of the template: its {{table}} would end the template's own {{ }}.
const editHint='{{table}} 处会放入柜号表格。这里的修改只用于这一次发送，不会改动配置里的模板。';
const missingText=group=>group.missing.map(key=>t(missingNames[key]||key)).join(' · ');
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
              <template v-if="row.lock">{{t('已有记录')}} · {{t(recordLabel(row.lock.status))}} <n-button class="resend-locked" size="tiny" :title="t('解除锁定后再次发送')" @click="resendLocked(row)">{{t('仍要发送')}}</n-button></template>
              <template v-else>{{t('已匹配')}}</template>
            </td>
            <td class="row-remove"><n-button size="tiny" quaternary type="error" :title="t('移除这个柜号')" @click="removeEntry(row.entry)">×</n-button></td>
          </tr>
        </table>
        <div v-if="group.missing.length" class="notice missing"><span>{{t('还需要配置：')}}</span><strong>{{missingText(group)}}</strong><n-button size="tiny" @click="configureCarrier(group)">{{t(group.profile?`配置 ${group.name}`:`新增或选择${kind}`)}}</n-button></div>
        <p v-if="group.channel==='cosco-portal'&&!group.many&&group.ready.length>1" class="hint">{{t('逐个提交，每张需人机验证')}}</p>
        <details v-if="previewOf(group)" class="group-preview" :open="groups.length===1&&!unresolved.length">
          <summary>{{t('预览')}}<span v-if="editOf(group)" class="edited-mark">{{t('已临时修改 · 仅本次发送')}}</span></summary>
          <template v-for="preview in [previewOf(group)]" :key="group.id+'p'">
            <div v-if="canEditMail(group)&&!editOf(group)?.editing" class="preview-tools">
              <n-button text size="tiny" class="edit-mail" :title="t('只修改这一次发送的邮件，不会改动配置里的模板')" @click="startEdit(group)">✎ {{t('编辑')}}</n-button>
              <n-button v-if="editOf(group)" text size="tiny" class="edit-mail" @click="discardEdit(group)">{{t('恢复模板')}}</n-button>
            </div>
            <form v-if="editOf(group)?.editing" class="mail-edit" @submit.prevent="finishEdit(group)">
              <template v-for="edit in [editOf(group)]" :key="group.id+'e'">
                <label class="field-label">To</label><n-input size="small" v-model:value="edit.to" :input-props="{autocomplete:'off',spellcheck:false}" :placeholder="t('多个邮箱用逗号分隔')"/>
                <label class="field-label">Cc</label><n-input size="small" v-model:value="edit.cc" :input-props="{autocomplete:'off',spellcheck:false}" :placeholder="t('多个邮箱用逗号分隔')"/>
                <label class="field-label">{{t('主题')}}</label><n-input size="small" v-model:value="edit.subject" placeholder=""/>
                <label class="field-label">{{t('正文')}}</label><n-input type="textarea" size="small" v-model:value="edit.body" :autosize="{minRows:5,maxRows:16}" placeholder=""/>
                <p class="hint">{{t(editHint)}}</p>
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
