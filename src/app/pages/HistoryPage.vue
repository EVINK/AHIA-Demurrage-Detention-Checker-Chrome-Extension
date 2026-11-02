<script setup lang="ts">
import {NButton} from 'naive-ui';
import {busy,historyRows,markSent,openDraft,openMailto,refresh,releaseRecord,t} from '../store.ts';
</script>

<template>
  <div class="section-top"><h2>{{t('操作记录')}}</h2><n-button id="refresh" size="small" @click="refresh">{{t('刷新')}}</n-button></div>
  <div id="history">
    <p v-if="!historyRows.length" class="empty">{{t('暂无操作记录')}}</p>
    <div v-for="row in historyRows" :key="row.key" class="history-row">
      <div>
        <strong>{{row.entry.container}} · {{row.entry.mbl}}</strong>
        <p>{{row.detail}}</p>
        <div class="history-state">{{t(row.state)}}{{row.suffix}}</div>
        <p v-if="row.entry.detail">{{t(row.entry.detail)}}</p>
      </div>
      <div class="history-buttons">
        <n-button v-if="row.openable" size="tiny" :disabled="busy" @click="openDraft(row.entry.tabId)">{{t(row.openLabel)}}</n-button>
        <template v-if="row.system&&row.entry.status==='draft'">
          <n-button size="tiny" @click="openMailto(row.entry.mailto)">{{t('重新打开邮件')}}</n-button>
          <n-button size="tiny" @click="markSent(row.entry.requestId)">{{t('我已发送')}}</n-button>
        </template>
        <n-button size="tiny" :disabled="busy" @click="releaseRecord(row.key,row.entry)">{{t('解除锁定')}}</n-button>
      </div>
    </div>
  </div>
</template>
