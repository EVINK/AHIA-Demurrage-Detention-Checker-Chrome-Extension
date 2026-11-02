<script setup lang="ts">
import {computed} from 'vue';
import {NButton} from 'naive-ui';
import {deleteTask,markSent,openDraft,openMailto,resendTask,stopTask,t,taskGroups,taskView,verifySent} from '../store.ts';

const sections=computed(()=>[
  {heading:`进行中（${taskGroups.value.running.length}）`,groups:taskGroups.value.running},
  {heading:`需要处理（${taskGroups.value.attention.length}）`,groups:taskGroups.value.attention}
].filter(section=>section.groups.length));
</script>

<template>
  <div class="section-top"><h2>{{t('进行中的任务')}}</h2></div>
  <div id="tasks">
    <p v-if="!taskGroups.all.length" class="empty">{{t('没有进行中的任务')}}</p>
    <template v-for="section in sections" :key="section.heading">
      <h3 class="task-heading">{{t(section.heading)}}</h3>
      <div v-for="group in section.groups" :key="group[0].requestId||group[0].container" class="task-row">
        <template v-for="task in [taskView(group)]" :key="task.names">
          <div>
            <strong>{{task.names}}</strong>
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
