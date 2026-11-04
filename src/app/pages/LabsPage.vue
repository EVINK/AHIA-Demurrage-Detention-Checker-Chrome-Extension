<script setup lang="ts">
import {computed,onMounted} from 'vue';
import {NButton,NInput} from 'naive-ui';
import {t} from '../store.ts';
import {chagui,downloadAirScript,duration,exportChaguiCache,importChaguiCache,importing,importText,loadChagui,startChagui,starting,timeText,watchChagui} from '../labs.ts';

const running=computed(()=>chagui.run?.status==='running');
const stateLabel={waiting:'等待',running:'进行中',done:'完成',error:'失败'};
const runLabel=computed(()=>({running:'查柜进行中',done:'上次查柜完成',error:'上次查柜失败'}[chagui.run?.status]||''));
const scripts=['ListA_Push.js','TH_ReadV2.js','TH_ReadPickup.js','TH_Apply.js'];
onMounted(()=>{loadChagui();watchChagui();});
</script>

<template>
  <div class="section-top"><h2>{{t('实验性功能')}}</h2></div>
  <div id="labs" class="labs">
    <div class="labs-card">
      <div class="section-top">
        <div>
          <strong>{{t('查柜')}}</strong>
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
          </li>
        </ol>
        <details v-if="chagui.run.plan" class="labs-plan" :open="!chagui.run.apply">
          <summary>{{t(chagui.run.apply?'本轮改动':'预览：将要做的改动')}}</summary>
          <table v-if="chagui.run.plan.changes.length">
            <tr><th>{{t('柜号')}}</th><th>{{t('行')}}</th><th>{{t('列')}}</th><th>{{t('原值')}}</th><th>{{t('新值')}}</th></tr>
            <template v-for="change in chagui.run.plan.changes" :key="change.container">
              <tr v-for="(cell,i) in change.cells" :key="cell.col"><td>{{i?'':change.container}}</td><td>{{i?'':change.row}}</td><td>{{cell.col}}</td><td>{{cell.beforeText}}</td><td>{{cell.afterText}}</td></tr>
            </template>
          </table>
          <p v-for="move in chagui.run.plan.moves" :key="move.container" class="hint">{{t(`移动 ${move.container}：第 ${move.from} 行 → 按码头排（${move.terminal}）`)}}</p>
          <p v-for="item in chagui.run.plan.skipped" :key="item.container+item.reason" class="hint labs-skip">{{item.container}}：{{t(item.reason)}}</p>
        </details>
      </template>
    </div>
    <div v-if="chagui.cache?.ready?.length" class="labs-card labs-plan">
      <strong>{{t('Appointed / Bookable')}}（{{chagui.cache.ready.length}}）</strong>
      <table>
        <tr><th>{{t('柜号')}}</th><th>{{t('状态')}}</th><th>{{t('码头')}}</th><th>Hold</th><th>LFD</th><th>{{t('预约')}}</th><th>{{t('摆置')}}</th></tr>
        <tr v-for="item in chagui.cache.ready" :key="item.container">
          <td>{{item.container}}</td><td>{{item.category}}</td><td>{{item.terminal}}</td><td>{{item.holds}}</td>
          <td>{{item.lfd}}<template v-if="item.lineLfd"> / SSL {{item.lineLfd}}</template></td><td>{{item.appointment}}</td><td>{{item.position}}</td>
        </tr>
      </table>
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
      <p class="hint">{{t('ListA_Push 在提柜表的“文档共享脚本”里运行，插件也存了一份。TH_ReadV2、TH_ReadPickup 只读，TH_Apply 写表，都会自动装进“我的脚本”。')}}</p>
      <div class="history-buttons labs-buttons">
        <n-button v-for="file in scripts" :key="file" size="small" @click="downloadAirScript(file)">{{t('下载')}} {{file.replace('.js','')}}</n-button>
      </div>
    </div>
  </div>
</template>
