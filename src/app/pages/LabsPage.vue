<script setup lang="ts">
import {computed,onMounted} from 'vue';
import {NButton,NInput} from 'naive-ui';
import {t} from '../store.ts';
import {chagui,downloadAirScript,duration,exportChaguiCache,importChaguiCache,importing,importText,loadChagui,startChagui,starting,timeText,watchChagui} from '../labs.ts';

const running=computed(()=>chagui.run?.status==='running');
const stateLabel={waiting:'等待',running:'进行中',done:'完成',error:'失败'};
const runLabel=computed(()=>({running:'查柜进行中',done:'上次查柜完成',error:'上次查柜失败'}[chagui.run?.status]||''));
onMounted(()=>{loadChagui();watchChagui();});
</script>

<template>
  <div class="section-top"><h2>{{t('实验性功能')}}</h2></div>
  <div id="labs" class="labs">
    <div class="labs-card">
      <div class="section-top">
        <div>
          <strong>{{t('查柜')}}</strong>
          <p class="hint">{{t('更新 Available V2，读取柜号写入缓存，再检查 Draydog 登录。全程在后台标签页运行。')}}</p>
        </div>
        <n-button id="chaguiStart" type="primary" :loading="starting||running" :disabled="starting||running" @click="startChagui">{{t('查柜')}}</n-button>
      </div>
      <template v-if="chagui.run">
        <div class="labs-run" :class="chagui.run.status">
          {{t(runLabel)}} · {{timeText(chagui.run.startedAt)}}<template v-if="duration(chagui.run)"> · {{t(duration(chagui.run))}}</template>
        </div>
        <ol class="labs-steps">
          <li v-for="step in chagui.run.steps" :key="step.key" :class="step.status">
            <span class="labs-state">{{t(stateLabel[step.status]||step.status)}}</span>
            <span>{{t(step.label)}}</span>
            <p v-if="step.detail">{{t(step.detail)}}</p>
          </li>
        </ol>
      </template>
    </div>
    <div class="labs-card">
      <div class="section-top"><strong>{{t('缓存')}}</strong><span v-if="chagui.cache" class="hint">{{timeText(chagui.cache.readAt)}}</span></div>
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
      <details class="labs-import">
        <summary>{{t('导入 / 导出缓存')}}</summary>
        <p class="hint">{{t('粘贴之前查柜留下的缓存 JSON（schemaVersion 1），每柜的状态、核验记录和审计记录会一起接过来。')}}</p>
        <n-input v-model:value="importText" type="textarea" size="small" :rows="3" :placeholder="t('粘贴缓存 JSON')"/>
        <div class="history-buttons labs-buttons">
          <n-button size="small" type="primary" :disabled="!importText.trim()||importing||running" :loading="importing" @click="importChaguiCache">{{t('导入缓存')}}</n-button>
          <n-button size="small" @click="exportChaguiCache">{{t('导出缓存')}}</n-button>
        </div>
      </details>
    </div>
    <div class="labs-card">
      <strong>{{t('脚本')}}</strong>
      <p class="hint">{{t('ListA_Push 在提柜表的“文档共享脚本”里运行；插件也存了一份，可下载备用。TH_ReadV2 只读，会自动装进“我的脚本”。')}}</p>
      <div class="history-buttons labs-buttons">
        <n-button size="small" @click="downloadAirScript('ListA_Push.js')">{{t('下载 ListA_Push')}}</n-button>
        <n-button size="small" @click="downloadAirScript('TH_ReadV2.js')">{{t('下载 TH_ReadV2')}}</n-button>
      </div>
    </div>
  </div>
</template>
