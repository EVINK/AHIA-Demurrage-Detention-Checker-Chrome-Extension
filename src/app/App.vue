<script setup lang="ts">
import {computed} from 'vue';
import {NConfigProvider,NDialogProvider,NMessageProvider,zhCN,enUS,esAR} from 'naive-ui';
import Shell from './Shell.vue';
import {language} from './store.ts';

const themeOverrides={common:{primaryColor:'#23674f',primaryColorHover:'#2f7f64',primaryColorPressed:'#195740',primaryColorSuppl:'#2f7f64',borderRadius:'6px',fontSize:'13px',fontFamily:'"Segoe UI","Microsoft YaHei",sans-serif'}};
const locale=computed(()=>({zh:zhCN,en:enUS,es:esAR}[language.value]));
</script>

<template>
  <n-config-provider :locale="locale" :theme-overrides="themeOverrides">
    <n-dialog-provider><n-message-provider><Shell/></n-message-provider></n-dialog-provider>
  </n-config-provider>
</template>
