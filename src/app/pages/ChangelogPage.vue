<script setup lang="ts">
import {NButton} from 'naive-ui';
import {CHANGELOG} from '../changelog.ts';
import {openFeature,t} from '../store.ts';

declare const __APP_VERSION__:string;
const current=__APP_VERSION__;
</script>

<template>
  <div id="changelog" class="changelog">
    <p class="changelog-intro">{{t('每个版本新增的功能和修改。点按钮可直接跳到功能所在的位置。')}}</p>
    <article v-for="entry in CHANGELOG" :key="entry.version" class="changelog-entry" :data-version="entry.version">
      <div class="changelog-head">
        <h3>v{{entry.version}}</h3>
        <span class="changelog-date">{{entry.date}}</span>
        <span v-if="entry.version===current" class="changelog-current">{{t('当前版本')}}</span>
      </div>
      <section v-for="item in entry.items" :key="item.title" class="changelog-item">
        <h4>{{t(item.title)}}</h4>
        <p>{{t(item.text)}}</p>
        <div v-if="item.jumps?.length" class="changelog-jumps">
          <n-button v-for="jump in item.jumps" :key="jump.target" size="small" secondary type="primary" :data-target="jump.target" @click="openFeature(jump.target)">{{t(jump.label)}}</n-button>
        </div>
      </section>
    </article>
  </div>
</template>
