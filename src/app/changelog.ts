// 更新日志 page data. Every version bump adds one entry at the top (see Memory.md, "Changelog tab").
// Texts are Chinese sources, translated through i18n-changelog.ts. A new feature gets jump buttons;
// `target` is one of the keys handled by openFeature() in store.ts.
export type ChangelogJump={label:string,target:'matson'|'chagui'|'ooclConfig'|'query'|'tasks'|'config'|'history'|'labs'|'autoCc'};
export type ChangelogItem={title:string,text:string,jumps?:ChangelogJump[]};
export type ChangelogEntry={version:string,date:string,items:ChangelogItem[]};

export const CHANGELOG:ChangelogEntry[]=[
  {version:'1.3.0',date:'2026-11-06',items:[
    {title:'Matson 柜查询',
      text:'在实验性功能里查 Matson 柜子：按 Matson 官网的事件和船期，把最新状态写到提柜表 B 列，可提时打 ✔，船到港后把行移到按码头排。先预览，确认后再写表。',
      jumps:[{label:'前往实验性功能',target:'matson'}]},
    {title:'OOCL Demurrage LFD 查询',
      text:'OOCL 的 Demurrage 不再发邮件询问，插件登录 OOCL 网站自己查 LFD，和 Draydog 比较取较早的日期写到提柜表 K 列，并在 Draydog 加 SSL LFD 备注。查柜时也会自动查 OOCL 柜子。先在配置页填写 OOCL 账号。',
      jumps:[{label:'配置 OOCL 账号',target:'ooclConfig'},{label:'前往查询页',target:'query'},{label:'前往查柜',target:'chagui'}]},
  ]},
];
