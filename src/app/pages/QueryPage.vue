<script setup lang="ts">
import {NButton,NInput,NSelect,NTag} from 'naive-ui';
import {busy,channelName,configureCarrier,containersInput,entryNote,groupLabels,groups,kind,lookup,moveGroup,pendingCount,previewOf,profileChoices,query,recordLabel,removeEntry,resendLocked,sendAll,sendGroup,sendAllLabel,sending,setManualMbl,setOverride,t,totals,typeOptions,chooseType,unresolved} from '../store.ts';

const missingNames={carrier:'船公司配置',type:'查询类型',to:'收件邮箱',requester:'工单 Requester',reference:'PD INV /BL /BKG /HOU # /SCAC Code',bodyTemplate:'正文模板',subjectTemplate:'主题模板'};
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
              <template v-if="row.lock">{{t('已有记录')}} · {{t(recordLabel(row.lock.status))}} <n-button text size="tiny" type="warning" @click="resendLocked(row)">{{t('仍要发送')}}</n-button></template>
              <template v-else>{{t('已匹配')}}</template>
            </td>
            <td class="row-remove"><n-button size="tiny" quaternary type="error" :title="t('移除这个柜号')" @click="removeEntry(row.entry)">×</n-button></td>
          </tr>
        </table>
        <div v-if="group.missing.length" class="notice missing"><span>{{t('还需要配置：')}}</span><strong>{{missingText(group)}}</strong><n-button size="tiny" @click="configureCarrier(group)">{{t(group.profile?`配置 ${group.name}`:`新增或选择${kind}`)}}</n-button></div>
        <p v-if="group.channel==='cosco-portal'&&!group.many&&group.ready.length>1" class="hint">{{t('逐个提交，每张需人机验证')}}</p>
        <details v-if="previewOf(group)" class="group-preview" :open="groups.length===1&&!unresolved.length">
          <summary>{{t('预览')}}</summary>
          <template v-for="preview in [previewOf(group)]" :key="group.id+'p'">
            <p v-if="preview.error" class="notice">{{t(preview.error)}}</p>
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
