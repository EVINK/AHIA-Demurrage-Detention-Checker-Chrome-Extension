<script setup lang="ts">
import {NButton,NInput,NSelect} from 'naive-ui';
import {addExtraRow,busy,carrierOptions,chooseCarrier,chooseType,configureDetected,containerInput,draftLabel,editMbl,extrasVisible,kind,multi,openDraft,openDraftVisible,pasteIntoContainer,pasteIntoRow,perform,pressEnter,query,removeMain,removeRow,rowLookup,rows,sendDisabled,sendLabel,t,typeOptions,view} from '../store.ts';

const containerProps={id:'container',autocomplete:'off',spellcheck:false,maxlength:32};
</script>

<template>
  <div class="query-layout">
    <section class="query-controls">
      <form id="inquiry" @submit.prevent="pressEnter">
        <div class="container-sticky">
          <label class="field-label" for="container">{{t('柜号')}} <span>CONTAINER</span></label>
          <div class="container-query">
            <n-input :value="query.container" :input-props="containerProps" :disabled="busy" :placeholder="t('粘贴柜号…')" @update:value="containerInput" @paste="pasteIntoContainer" @keydown.enter.prevent="pressEnter"/>
            <button v-if="rows.length" id="removeMain" type="button" :title="t('删除这个柜号，下面的柜号会往上补')" @click="removeMain">×</button>
            <button v-if="multi" id="addContainer" class="add-container" type="button" :title="t('同一个 ONE 会话再加一个柜号')" @click="addExtraRow()">＋</button>
            <button id="identify" type="button" :disabled="busy" :title="t('优先查询本地缓存，未命中时读取提柜表')" @click="perform('identify')">{{t('查询')}}</button>
          </div>
        </div>
        <div v-show="extrasVisible" id="extraContainers" class="extra-containers">
          <div v-for="row in rows" :key="row.key" class="extra-row" :class="{mismatch:row.mismatch}">
            <n-input v-model:value="row.value" :input-props="{id:`extra-${row.key}`,maxlength:32,autocomplete:'off',spellcheck:false}" :placeholder="t('再加一个柜号…')" size="small" @update:value="rowLookup(row)" @paste="pasteIntoRow($event,row)"/>
            <button type="button" :title="t('移除这个柜号')" @click="removeRow(row)">×</button>
            <span class="extra-status" :class="row.cls">{{t(row.note)}}</span>
          </div>
        </div>
        <p class="hint">{{t('粘贴或点击查询优先读缓存，未命中时查表。')}}</p>
        <div class="field-pair">
          <div><label class="field-label" id="carrierLabel">{{t(kind)}}</label><n-select id="carrier" :value="query.carrier" :options="carrierOptions" :disabled="busy" size="small" @update:value="chooseCarrier"/></div>
          <div><label class="field-label">{{t('查询类型')}}</label><n-select id="inquiryType" :value="query.inquiryType" :options="typeOptions" :disabled="busy" size="small" @update:value="chooseType"/></div>
        </div>
        <label class="field-label" for="manualMbl">MBL <span>{{t('可手动填写或修改')}}</span></label>
        <n-input :value="query.mbl" :input-props="{id:'manualMbl',maxlength:60,autocomplete:'off'}" :disabled="busy" :placeholder="t('未匹配时请填写 MBL')" @update:value="editMbl"/>
        <div id="match" class="match">
          <span class="eyebrow">{{t('匹配结果')}}</span>
          <strong id="matchCarrier">{{t(view.matchCarrier)}}</strong>
          <span id="matchMbl">{{t(view.matchMbl)}}</span>
          <small id="matchSource">{{t(view.matchSource)}}</small>
        </div>
        <div v-if="view.needsConfig" id="needsConfig" class="notice">
          <strong id="missingTitle">{{t(view.missingTitle)}}</strong>
          <p id="missingDetail">{{t(view.missingDetail)}}</p>
          <n-button id="configureDetected" size="small" :disabled="busy" @click="configureDetected">{{t(view.configureLabel)}}</n-button>
        </div>
        <n-button id="send" type="primary" block attr-type="submit" :disabled="sendDisabled">{{t(sendLabel)}}</n-button>
        <div class="actions"><n-button id="draft" size="small" :disabled="sendDisabled" @click="perform('draft')">{{t(draftLabel)}}</n-button></div>
        <n-button v-if="openDraftVisible" id="openDraft" class="open-draft" size="small" dashed block @click="openDraft()">{{t(view.openDraftLabel)}}</n-button>
        <p class="hint safe-note">{{t('查表不会发信。生成邮件保留 Gmail 原签名。')}}</p>
      </form>
    </section>
    <section class="email-preview">
      <div class="section-top"><h2>{{t('邮件预览')}}</h2><span id="previewType" class="mini-badge">{{view.previewType}}</span></div>
      <p id="source" class="hint">{{t(view.source)}}</p>
      <dl>
        <dt>To</dt><dd id="to">{{t(view.to)}}</dd>
        <dt>Cc</dt><dd id="cc">{{view.cc}}</dd>
        <dt>{{t('主题')}}</dt><dd id="subject">{{view.previewReady?view.subject:t(view.subject)}}</dd>
      </dl>
      <div id="mailBody" class="mail-body">
        <template v-if="view.previewReady">
          <div v-if="view.html" v-html="view.html"></div>
          <p v-for="line in view.lines" :key="line">{{line}}</p>
        </template>
        <p v-else class="empty-preview">{{t('匹配船公司并完成配置后显示邮件预览。')}}</p>
      </div>
      <p v-if="view.signatureVisible" id="signatureNote" class="signature-note">{{t(view.signatureNote)}}</p>
    </section>
  </div>
</template>
