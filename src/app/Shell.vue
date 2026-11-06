<script setup lang="ts">
import {computed,h,onMounted} from 'vue';
import {NButton,NModal,NRadioButton,NRadioGroup,NSelect,useDialog} from 'naive-ui';
import ChangelogPage from './pages/ChangelogPage.vue';
import ConfigPage from './pages/ConfigPage.vue';
import HistoryPage from './pages/HistoryPage.vue';
import LabsPage from './pages/LabsPage.vue';
import QueryPage from './pages/QueryPage.vue';
import TasksPage from './pages/TasksPage.vue';
import {boot,duplicateDialog,duplicateForce,duplicateView,historyRows,language,message,rememberScroll,setLanguage,setMode,settings,showPage,t,taskGroups,ui,useAsk} from './store.ts';
import {LANGUAGES} from '../core/i18n.ts';
import {oocl} from './oocl.ts';

declare const __APP_VERSION__:string;
const version=`v${__APP_VERSION__}`;
const modeTheme={buttonColor:'transparent',buttonColorActive:'#d7eee0',buttonTextColor:'#deefe3',buttonTextColorActive:'#204d42',buttonTextColorHover:'#ffffff',buttonBorderColor:'#72988a',buttonBorderColorActive:'#d7eee0',buttonBorderColorHover:'#72988a',buttonBoxShadow:'none',buttonBoxShadowFocus:'none',buttonBoxShadowHover:'none'};
const headerSelection={color:'transparent',colorActive:'transparent',textColor:'#deefe3',placeholderColor:'#deefe3',arrowColor:'#deefe3',border:'1px solid #72988a',borderHover:'1px solid #d7eee0',borderActive:'1px solid #d7eee0',borderFocus:'1px solid #d7eee0',boxShadowActive:'none',boxShadowFocus:'none',boxShadowHover:'none'};
const languageTheme={peers:{InternalSelection:headerSelection}};
const dialog=useDialog();
// Replaces window.confirm, which stops working once the user ticks "prevent this page from creating additional dialogs".
useAsk(text=>new Promise(resolve=>{
  let answered=false;
  const answer=value=>{if(!answered){answered=true;resolve(value);}};
  dialog.warning({title:'Trucker Helper',content:()=>h('div',{class:'dialog-text'},t(text)),positiveText:t('确定'),negativeText:t('取消'),maskClosable:false,
    onPositiveClick:()=>answer(true),onNegativeClick:()=>answer(false),onClose:()=>answer(false),onEsc:()=>answer(false)});
}));
// A running OOCL Demurrage lookup counts as one task in progress.
const tabs=computed(()=>[{page:'query',label:'查询'},{page:'tasks',label:'进行中',count:taskGroups.value.running.length+(oocl.run?.status==='running'?1:0)},{page:'config',label:'配置'},{page:'history',label:'记录',count:historyRows.value.length},{page:'labs',label:'实验性功能'},{page:'changelog',label:'更新日志'}]);
const languageOptions=Object.entries(LANGUAGES).map(([value,label])=>({value,label}));
onMounted(boot);
</script>

<template>
  <main class="popup">
    <header>
      <div class="brand-mark">T</div>
      <div><h1>Trucker Helper</h1><span class="brand-sub">{{t('船公司邮件查询')}}</span></div>
      <n-radio-group class="mode-switch" size="small" :theme-overrides="modeTheme" :value="settings.mode" :aria-label="t('工作模式')" @update:value="setMode">
        <n-radio-button value="carrier" data-mode="carrier">{{t('航司模式')}}</n-radio-button>
        <n-radio-button value="terminal" data-mode="terminal">{{t('码头模式')}}</n-radio-button>
      </n-radio-group>
      <n-select id="language" class="lang-select" size="small" :theme-overrides="languageTheme" :title="t('界面语言')" :value="language" :options="languageOptions" :consistent-menu-width="false" @update:value="setLanguage"/>
    </header>
    <nav class="tabs" :aria-label="t('插件页面')">
      <button v-for="tab in tabs" :key="tab.page" class="tab" type="button" :class="{active:ui.page===tab.page}" :data-page="tab.page" :aria-selected="ui.page===tab.page" @click="showPage(tab.page)">
        {{t(tab.label)}} <span v-if="tab.count!==undefined">{{tab.count}}</span>
      </button>
    </nav>
    <div class="pages">
      <section v-show="ui.page==='query'" id="page-query" class="page" :aria-label="t('查询')" @scroll.passive="rememberScroll('query',($event.target as HTMLElement).scrollTop)"><QueryPage/></section>
      <section v-show="ui.page==='tasks'" id="page-tasks" class="page" :aria-label="t('进行中')" @scroll.passive="rememberScroll('tasks',($event.target as HTMLElement).scrollTop)"><TasksPage/></section>
      <section v-show="ui.page==='config'" id="page-config" class="page" :aria-label="t('配置')" @scroll.passive="rememberScroll('config',($event.target as HTMLElement).scrollTop)"><ConfigPage/></section>
      <section v-show="ui.page==='history'" id="page-history" class="page" :aria-label="t('操作记录')" @scroll.passive="rememberScroll('history',($event.target as HTMLElement).scrollTop)"><HistoryPage/></section>
      <section v-show="ui.page==='labs'" id="page-labs" class="page" :aria-label="t('实验性功能')" @scroll.passive="rememberScroll('labs',($event.target as HTMLElement).scrollTop)"><LabsPage/></section>
      <section v-show="ui.page==='changelog'" id="page-changelog" class="page" :aria-label="t('更新日志')" @scroll.passive="rememberScroll('changelog',($event.target as HTMLElement).scrollTop)"><ChangelogPage/></section>
    </div>
    <footer>
      <span class="status-dot" :class="message.type"></span>
      <div id="status" role="status" aria-live="polite" :class="message.type">{{t(message.text)}}</div>
      <span id="version">{{version}}</span>
    </footer>
    <n-modal id="duplicate" v-model:show="duplicateDialog.show" preset="dialog" type="warning" :title="t('已有记录，未发送')" :mask-closable="false">
      <p class="dialog-text">{{duplicateDialog.lines.join('\n')}}</p>
      <p class="dialog-text">{{t(duplicateDialog.note)}}</p>
      <template #action>
        <n-button id="duplicateCancel" @click="duplicateDialog.show=false">{{t('取消')}}</n-button>
        <n-button id="duplicateView" @click="duplicateView">{{t('查看记录')}}</n-button>
        <n-button id="duplicateForce" type="primary" :disabled="duplicateDialog.running" @click="duplicateForce">{{t('强制重发')}}</n-button>
      </template>
    </n-modal>
  </main>
</template>
