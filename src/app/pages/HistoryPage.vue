<script setup lang="ts">
import {NButton} from 'naive-ui';
import {busy,exportHistory,historyRows,markSent,openDraft,openMailto,refresh,releaseRecord,t} from '../store.ts';
const mmdd=(iso:string)=>iso?iso.slice(5).replace('-','/'):'';
</script>

<template>
  <div class="section-top"><h2>{{t('操作记录')}}</h2><div class="history-buttons"><n-button id="exportHistory" size="small" @click="exportHistory">{{t('导出记录')}}</n-button><n-button id="refresh" size="small" @click="refresh">{{t('刷新')}}</n-button></div></div>
  <div id="history">
    <p v-if="!historyRows.length" class="empty">{{t('暂无操作记录')}}</p>
    <div v-for="row in historyRows" :key="row.key" class="history-row">
      <div>
        <strong>{{row.entry.container}} · {{row.entry.mbl}}</strong>
        <p>{{row.detail}}</p>
        <div class="history-state">{{t(row.state)}}{{row.suffix}}</div>
        <template v-if="row.oocl">
          <!-- The run's table row for this container, only when opened. -->
          <details v-if="row.entry.lookup" class="diagnostics">
            <summary>{{t('详情')}}</summary>
            <table class="container-table oocl-table">
              <tr><th class="oocl-nowrap">{{t('柜号')}}</th><th class="oocl-nowrap">{{t('码头')}}</th><th class="oocl-value">{{t('状态')}}</th><th class="oocl-nowrap">SSL</th><th class="oocl-nowrap">Draydog</th><th class="oocl-nowrap">LFD</th><th class="oocl-nowrap">{{t('提柜表更新')}}</th></tr>
              <tr>
                <td class="mono oocl-nowrap">{{row.entry.container}}</td>
                <td class="oocl-nowrap">{{row.entry.lookup.terminal}}</td>
                <td class="oocl-value">{{String(row.entry.lookup.status||'').replace(/,/g,',​')}}</td>
                <td class="oocl-nowrap">{{mmdd(row.entry.lookup.ooclLfd)}}</td>
                <td class="oocl-nowrap">{{mmdd(row.entry.lookup.draydogLfd)}}</td>
                <td class="oocl-nowrap"><b>{{mmdd(row.entry.lookup.lfd)}}</b></td>
                <td class="oocl-nowrap"><template v-if="row.entry.lookup.row"><template v-if="row.entry.lookup.before===row.entry.lookup.after">{{t('不用改')}}</template><template v-else>{{row.entry.lookup.before||'—'}} <span class="oocl-arrow">→</span> {{row.entry.lookup.after}}</template></template><template v-else>{{t(row.entry.reason||'—')}}</template></td>
              </tr>
            </table>
          </details>
        </template>
        <p v-else-if="row.entry.detail">{{t(row.entry.detail)}}</p>
        <p v-if="row.recovered">{{t(row.recovered)}}</p>
        <details v-if="row.diagnostics" class="diagnostics"><summary>{{t('诊断信息')}}</summary><pre>{{JSON.stringify(row.diagnostics,null,2)}}</pre></details>
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
