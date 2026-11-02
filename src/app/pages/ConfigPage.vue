<script setup lang="ts">
import {NButton,NCheckbox,NInput,NInputNumber,NSelect} from 'naive-ui';
import {addProfile,addType,adding,channelChanged,channelOptions,channelVisible,clearCache,closeAddProfile,closeAddType,copyScript,currentProfile,currentType,customType,defaultCarrierOptions,defaultTypeOptions,deleteDisabled,deleteProfile,deleteType,downloadScript,editChannel,editTypeOptions,editingId,editingType,exportConfig,flushSave,form,importInput,importText,isOpen,kind,openAddProfile,openAddType,openDefaultApps,profileOptions,restoreDefaults,saveLine,scriptFallback,selectProfile,selectType,setOpen,t,terminalMode,testNotification,useStandardTemplate} from '../store.ts';

// Kept here because their {{tokens}} cannot sit inside a template expression.
const TYPE_HINT='{{Type}} 显示为这个名称',SUBJECT_HINT='须含 {{container}} {{mbl}}',BODY_HINT='须含一个 {{table}}',CHAT_HINT='单行，必须包含 {{type}} {{container}} {{mbl}}';
const mailClients=()=>[{value:'gmail',label:t('Gmail 网页（推荐）')},{value:'program',label:t('电脑默认邮件程序（自动填写，手动发送）')}];
const mailPrograms=()=>[{value:'foxmail',label:t('Foxmail（正文分行 + 带框表格）')},{value:'outlook',label:t('Outlook（纯文本，柜号与 MBL 逐行）')}];
const field=id=>({id,autocomplete:'off'});
const toggle=(id,event)=>setOpen(id,event.target.open);
</script>

<template>
  <div class="config-bar">
    <n-select v-if="currentProfile" id="editCarrier" class="config-select" size="small" filterable :value="editingId" :options="profileOptions" :aria-label="t('选择要编辑的项')" @update:value="selectProfile"/>
    <n-button id="newCarrier" size="small" @click="openAddProfile()">{{t('＋ 新增')}}</n-button>
    <n-button v-if="currentProfile" id="deleteCarrier" size="small" tertiary type="error" :disabled="deleteDisabled" @click="deleteProfile">{{t('删除')}}</n-button>
    <span id="saveState" class="save-state" :class="saveLine.type">{{t(saveLine.text)}}</span>
  </div>
  <div v-if="adding.profile" id="newProfileRow" class="inline-add">
    <n-input v-model:value="adding.profileName" :input-props="field('newProfileName')" :maxlength="80" size="small" :placeholder="t(`${kind}名称`)" @keydown.enter.prevent="addProfile" @keydown.esc="closeAddProfile"/>
    <n-button id="confirmNewProfile" type="primary" size="small" @click="addProfile">{{t('添加')}}</n-button>
    <n-button id="cancelNewProfile" size="small" @click="closeAddProfile">{{t('取消')}}</n-button>
  </div>
  <p v-if="!currentProfile" id="noProfiles" class="notice">{{t('还没有码头。点击「＋ 新增」添加码头，再为它添加查询类型。')}}</p>
  <form v-if="currentProfile" id="carrierForm" class="profile-form" @submit.prevent="flushSave">
    <div class="field-pair">
      <div><label class="field-label" id="nameLabel" for="carrierName">{{t(`${kind}名称`)}}</label><n-input v-model:value="form.name" :input-props="field('carrierName')" :maxlength="80"/></div>
      <div><label class="field-label" for="greeting">{{t('称呼')}} <span v-text="'{{steam shipping line}}'"></span></label><n-input v-model:value="form.greeting" :input-props="field('greeting')" :maxlength="80"/></div>
    </div>
    <div class="type-bar">
      <div class="type-select"><label class="field-label">{{t('查询类型')}}</label><n-select id="editType" size="small" :disabled="!currentType" :value="editingType" :options="editTypeOptions" @update:value="selectType"/></div>
      <n-button id="newType" size="small" @click="openAddType">{{t('＋ 新增类型')}}</n-button>
      <n-button v-if="currentType" id="deleteType" size="small" tertiary type="error" @click="deleteType">{{t('删除此类型')}}</n-button>
    </div>
    <div v-if="adding.type" id="newTypeRow" class="inline-add">
      <n-input v-model:value="adding.typeName" :input-props="field('newTypeName')" :maxlength="80" size="small" :placeholder="t('类型名称，例如 Exam Hold')" @keydown.enter.prevent="addType" @keydown.esc="closeAddType"/>
      <n-button id="confirmNewType" type="primary" size="small" @click="addType">{{t('添加')}}</n-button>
      <n-button id="cancelNewType" size="small" @click="closeAddType">{{t('取消')}}</n-button>
    </div>
    <p v-if="!currentType" id="noTypes" class="hint">{{t('还没有查询类型，点击「＋ 新增类型」添加，然后填写收件人和模板。')}}</p>
    <div v-if="currentType" id="typeFields">
      <div v-if="customType" id="typeLabelRow"><label class="field-label" for="typeLabel">{{t('类型名称')}} <span>{{t(TYPE_HINT)}}</span></label><n-input v-model:value="form.typeLabel" :input-props="field('typeLabel')" :maxlength="80"/></div>
      <div v-show="editChannel==='email'" id="emailFields" class="field-pair">
        <div><label class="field-label" for="carrierTo">{{t('收件 To')}}</label><n-input v-model:value="form.to" :input-props="field('carrierTo')" :placeholder="t('多个邮箱用逗号分隔')"/></div>
        <div><label class="field-label" for="carrierCc">{{t('抄送 Cc')}}</label><n-input v-model:value="form.cc" :input-props="field('carrierCc')" :placeholder="t('多个邮箱用逗号分隔')"/></div>
      </div>
      <div v-show="editChannel==='email'" id="subjectFields"><label class="field-label" for="subjectTemplate">{{t('主题模板')}} <span>{{t(SUBJECT_HINT)}}</span></label><n-input v-model:value="form.subject" :input-props="field('subjectTemplate')" :maxlength="400"/></div>
      <div v-show="editChannel!=='one-chat'" id="bodyFields">
        <div class="label-row"><label class="field-label" for="bodyTemplate">{{t('正文模板')}} <span>{{t(BODY_HINT)}}</span></label><n-button id="standardTemplate" text size="tiny" @click="useStandardTemplate">{{t('使用标准模板')}}</n-button></div>
        <n-input v-model:value="form.body" type="textarea" :input-props="field('bodyTemplate')" :rows="6" :maxlength="10000"/>
        <p class="token-help">{{t('可用：')}} <code v-for="token in ['{{carrier}}','{{steam shipping line}}','{{type}}','{{Type}}','{{container}}','{{mbl}}','{{table}}']" :key="token" v-text="token"></code></p>
      </div>
    </div>
    <details v-if="!terminalMode" id="advanced" class="advanced" :open="isOpen('advanced')" @toggle="toggle('advanced',$event)">
      <summary>{{t('高级设置')}}</summary>
      <div v-if="channelVisible" id="channelRow"><label class="field-label">{{t('此类型的发送方式')}}</label><n-select id="channel" size="small" v-model:value="form.channel" :options="channelOptions" @update:value="channelChanged"/></div>
      <div class="field-pair">
        <div><label class="field-label" for="aliases">{{t('表中名称 / 别名')}}</label><n-input v-model:value="form.aliases" :input-props="field('aliases')" :placeholder="t('MSC, 地中海')"/></div>
        <div><label class="field-label" for="mblPrefixes">{{t('MBL 前缀')}}</label><n-input v-model:value="form.prefixes" :input-props="field('mblPrefixes')" :placeholder="t('例如 MEDU')"/></div>
      </div>
      <div v-show="editChannel==='cosco-portal'" id="portalFields">
        <div class="field-pair">
          <div><label class="field-label" for="portalRequester">Requester</label><n-input v-model:value="form.portalRequester" :input-props="field('portalRequester')" :maxlength="254"/></div>
          <div><label class="field-label" for="portalReference">PD INV /BL /BKG /HOU # /SCAC Code</label><n-input v-model:value="form.portalReference" :input-props="field('portalReference')" :maxlength="80"/></div>
        </div>
        <div class="field-pair">
          <div><label class="field-label" for="portalShipmentType">Shipment Type</label><n-input v-model:value="form.portalShipmentType" :input-props="field('portalShipmentType')" :maxlength="80"/></div>
          <div><label class="field-label" for="portalService">Per Diem Services</label><n-input v-model:value="form.portalService" :input-props="field('portalService')" :maxlength="80"/></div>
        </div>
        <small class="hint">{{t('Detention 提交到 support.cosco-usa.com；On-Hire 提交到 coscoshippingla.freshdesk.com。')}}</small>
      </div>
      <div v-show="editChannel==='one-chat'" id="chatFields">
        <div class="field-pair">
          <div><label class="field-label" for="chatFirstName">First Name</label><n-input v-model:value="form.chatFirstName" :input-props="field('chatFirstName')" :maxlength="80"/></div>
          <div><label class="field-label" for="chatLastName">Last Name</label><n-input v-model:value="form.chatLastName" :input-props="field('chatLastName')" :maxlength="80"/></div>
        </div>
        <div class="field-pair">
          <div><label class="field-label" for="chatEmail">Email</label><n-input v-model:value="form.chatEmail" :input-props="field('chatEmail')" :maxlength="254"/></div>
          <div><label class="field-label" for="chatCountry">Country</label><n-input v-model:value="form.chatCountry" :input-props="field('chatCountry')" :maxlength="80"/></div>
        </div>
        <label class="field-label" for="chatMessage">{{t('聊天消息')}} <span>{{t(CHAT_HINT)}}</span></label><n-input v-model:value="form.chatMessage" :input-props="field('chatMessage')" :maxlength="500"/>
      </div>
    </details>
  </form>
  <details id="connectionSection" class="settings-section" :open="isOpen('connectionSection')" @toggle="toggle('connectionSection',$event)">
    <summary>{{t('连接与默认选项')}}</summary>
    <form id="connectionForm" @submit.prevent="flushSave">
      <label class="field-label" for="sheetUrl">{{t('提柜表链接')}}</label><n-input v-model:value="form.sheetUrl" :input-props="field('sheetUrl')"/>
      <div class="field-pair">
        <div><label class="field-label" for="gmailIndex">{{t('Gmail 账号编号（/u/ 后）')}}</label><n-input-number v-model:value="form.gmailIndex" :input-props="field('gmailIndex')" :min="0" :max="20" :show-button="false"/></div>
        <div><label class="field-label">{{t('默认船公司')}}</label><n-select id="defaultCarrierId" size="small" v-model:value="form.defaultCarrierId" :options="defaultCarrierOptions"/></div>
      </div>
      <label class="field-label">{{t('默认查询类型')}}</label><n-select id="defaultInquiryType" size="small" v-model:value="form.defaultInquiryType" :options="defaultTypeOptions"/>
      <label class="field-label">{{t('邮件发送方式')}}</label><n-select id="mailClient" size="small" v-model:value="form.mailClient" :options="mailClients()"/>
      <template v-if="form.mailClient==='program'">
        <div id="mailProgramRow"><label class="field-label">{{t('邮件程序')}} <span>{{t('须与 Windows 默认邮件程序一致')}}</span></label><n-select id="mailProgram" size="small" v-model:value="form.mailProgram" :options="mailPrograms()"/></div>
        <div id="mailClientNotice" class="notice">
          {{t('用电脑上的邮件程序时：')}}
          <ul>
            <li>{{t('插件打开填好收件人、抄送、主题和正文的写信窗口，')}}<b>{{t('不能自动发送')}}</b>{{t('，需要你在邮件程序里点发送。')}}</li>
            <li>{{t('插件')}}<b>{{t('无法确认是否已发出')}}</b>{{t('，发完后要回到插件点「我已发送」，记录才会变成已发送。')}}</li>
            <li>{{t('签名由邮件程序自己添加，插件不检查签名。')}}</li>
            <li>{{t('第一次使用时 Chrome 会询问是否打开外部程序，请勾选「始终允许」；Windows 的默认邮件程序需要先设置好。')}}</li>
          </ul>
          <p class="mail-program-links">{{t('插件只能打开')}} <b>{{t('Windows 默认邮件程序')}}</b>{{t('（无法直接指定其他程序，也无法检测是否已安装），这里选的程序必须与 Windows 默认邮件程序一致。没有安装：')}}<a href="https://www.foxmail.com/" target="_blank" rel="noopener">{{t('下载 Foxmail')}}</a> · <a href="https://apps.microsoft.com/detail/9NRX63209R7B" target="_blank" rel="noopener">{{t('下载 Outlook（Microsoft Store）')}}</a> · <a id="defaultAppsLink" href="ms-settings:defaultapps" rel="noopener" @click.prevent="openDefaultApps">{{t('打开 Windows 默认应用设置')}}</a>{{t('（搜索「MAILTO」并选择）。')}}</p>
        </div>
      </template>
    </form>
  </details>
  <details id="autoCcSection" class="settings-section" :open="isOpen('autoCcSection')" @toggle="toggle('autoCcSection',$event)">
    <summary>{{t('实验性功能：Gmail 自动抄送（Auto CC）')}}</summary>
    <form id="autoCcForm" @submit.prevent="flushSave">
      <p class="hint">{{t('发件人在名单内时，写信和回复自动加上抄送；其他发件人不受影响。')}}</p>
      <n-checkbox id="autoCcEnabled" class="check" v-model:checked="form.autoCcEnabled">{{t('开启 Auto CC')}}</n-checkbox>
      <label class="field-label" for="autoCcSenders">{{t('发件人')}}</label><n-input v-model:value="form.autoCcSenders" :input-props="field('autoCcSenders')" :placeholder="t('多个邮箱用逗号分隔')"/>
      <label class="field-label" for="autoCcCc">{{t('抄送对象')}}</label><n-input v-model:value="form.autoCcCc" :input-props="field('autoCcCc')" :placeholder="t('多个邮箱用逗号分隔')"/>
    </form>
  </details>
  <details id="importSection" class="settings-section" :open="isOpen('importSection')" @toggle="toggle('importSection',$event)">
    <summary>{{t('导入 / 导出配置')}}</summary>
    <label class="field-label" for="importText">{{t('导入')}} <span>{{t('粘贴后立即替换配置，操作记录保留')}}</span></label>
    <n-input :value="importText" type="textarea" :input-props="field('importText')" :rows="3" :placeholder="t('粘贴 JSON 内容')" @update:value="importInput"/>
    <div class="actions"><n-button id="exportConfig" size="small" @click="exportConfig">{{t('导出 JSON')}}</n-button><n-button id="restoreDefaults" size="small" @click="restoreDefaults">{{t('恢复默认配置')}}</n-button></div>
  </details>
  <details id="toolsSection" class="settings-section" :open="isOpen('toolsSection')" @toggle="toggle('toolsSection',$event)">
    <summary>{{t('缓存、通知与脚本')}}</summary>
    <p class="hint">{{t('清除后下次查询会重新读取提柜表，配置和操作记录保留。')}}</p>
    <div class="actions"><n-button id="clearCache" size="small" @click="clearCache">{{t('清除本地缓存')}}</n-button><n-button id="testNotification" size="small" @click="testNotification">{{t('发送测试通知')}}</n-button></div>
    <div class="actions"><n-button id="copyScript" size="small" @click="copyScript">{{t('复制只读脚本')}}</n-button><n-button id="downloadScript" size="small" @click="downloadScript">{{t('下载只读脚本')}}</n-button></div>
    <n-input v-if="scriptFallback" :value="scriptFallback" type="textarea" :input-props="field('scriptFallback')" :rows="5" readonly :aria-label="t('只读脚本代码')"/>
  </details>
</template>
