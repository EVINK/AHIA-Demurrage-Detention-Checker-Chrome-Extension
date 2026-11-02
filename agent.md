# Trucker Helper（原 LFD Inquiry）— Agent 交接文档

更新时间：2026-11-02（America/Los_Angeles）。代码版本：**0.7.2**（Vue 重写分支，结构和命令见 Memory.md，本文件的文件路径是重写前的）（改名与多语言，见第 12 节；Auto CC，见第 11 节；配置改为 profile.types、自动保存、码头模式，见第 10 节；更早：默认邮件程序 Foxmail/Outlook；Foxmail 自动填写；导入改在标签页；重复锁可强制重发；Gmail 收件人兼容其他插件；ONE 白屏修复；COSCO On-Hire 工单；On-Hire 多柜号、ONE 气泡文字修复；可选本机邮件程序；On-Hire；ONE 对话复用、独立小窗、终止/删除；浮动小窗+通知；查询不阻塞/后台任务/ONE 多柜号；ONE 在线客服；英文界面兼容；2026-10-14：发送确认加严、COSCO 工单网站、取消DO 后分段读取、日志虚拟列表读取、脚本自动安装、找不到柜号提示框，见第 6 节）。
Chrome 现直接从 WSL 目录 `/home/evink/demurrage-lfd-extension` 加载；git 分支 `fix/gmail-send-confirmation`。
本文件依据本次对话及当前源码整理；它是工程交接，不代表安装在 Chrome 中的版本已自动更新。

## 1. 接手起点

- 工作区：`C:\Users\AMERI\Documents\Codex\2026-10-08\chrome-2`
- Chrome 加载的源目录：工作区下 `demurrage-lfd-extension`。
- 本文件在源目录中，交付副本在工作区 `outputs/agent.md`。
- 最新安装包：`outputs/lfd-inquiry-extension-v0.2.9.zip`。
- 使用说明：源目录 `README.md`，交付副本 `outputs/安装说明.md`。
- `work/` 是一次性修改/导出脚本，**不要重复执行旧升级脚本**；它们不是正式构建系统。
- 当前没有必须安装的 npm 依赖，没有服务器端项目，没有数据库服务。
- 最近一次完整 Node 测试：74 项通过（v0.2.9）。本次编写交接文件没有改动功能代码。

建议先读本文件、manifest.json、service.js、core.js，再根据新任务检查对应模块。README 有逐次升级留下的历史描述；具体行为以当前代码及下述最新需求为准。

## 2. 产品目标与用户的最终要求

Chrome 工具栏弹窗中输入柜号，取得 MBL 和航司（SSL），按航司配置准备 Gmail 的 Demurrage 或 Detention LFD 查询邮件，保留 Gmail 原签名。**插件并不直接取得 LFD 日期**；目前是取得发信所需信息并发询问邮件。

当前要求：

1. 真正的工具栏 popup，780 × 600，不把主界面打开成网页标签。
2. 柜号栏滚动时吸顶；“查询”按钮融合在柜号输入框内。
3. 粘贴完整柜号后约 700ms 自动查询。粘贴和点击查询都先查本地缓存，柜号未命中才读取指定金山文档的“提柜”表。
4. 发送/生成草稿不重复查表。手动修改航司、MBL、Demurrage/Detention 只更新本地预览。
5. 未取得 MBL 时允许手填，未识别航司时允许手选；缺少收件人、正文等航司配置时提示首次配置并阻止发信。
6. 自定义航司、邮箱、称呼、主题、正文、识别别名及 MBL 前缀。配置支持 JSON 导入/导出。
7. 取消额外添加 `amerihua2606@gmail.com` 的选项；Cc 只按各航司配置生成。旧 `extraCc` 字段兼容接收但忽略。不要恢复旧版自动加抄送逻辑。
8. 模板占位符由 `{{greeting}}` 改成 `{{steam shipping line}}`；旧模板自动转换。JSON 航司对象内部字段仍叫 `greeting`，以保留兼容性。
9. 同一柜号多行时，按文档行号从上往下，选第一条 MBL 和 SSL 都非空的**整行**；不可拼接两行字段。其他重复项仅从插件缓存删除。
10. 缓存仅保存柜号、MBL、SSL 完整的记录；单条缺字段也不能缓存。已有缓存下次读取时清理，新缓存生成时同样过滤。
11. 配置页有“清除本地缓存”，只清除查表快照和当前操作状态，不清航司配置、邮件记录、归档。
12. 已获用户授权添加 `unlimitedStorage`；用户当时明确只要这项权限，其他容量/淘汰/数据库方案暂不需要。

金山文档业务数据必须保持原样。用户已明确确认“删除其他的”只指本地缓存，**不是删除在线表格行**。

## 3. 外部环境与默认数据

- 金山文档：`https://www.kdocs.cn/l/ce3LmgRtHK2F`。
- 工作表：精确名称 `提柜`。
- Gmail 默认账号：`amerihua.op001@gmail.com`；默认 `/u/0/`，可配置。
- Maersk 默认 To：`us.customerexperience@maersk.com`。
- 默认 Cc：`truck@darwinpacific.com`、`service@darwinpacific.com`。
- 内置 Maersk、MSC。MSC 源码默认 To 为空，需用户配置；**用户真实 Chrome 中已有自定义配置，不要用源码默认值覆盖它**。
- 用户已在自己的截图中展示过 MSC 正式模式及“Gmail 已显示发送成功”。这是用户提供的使用证据，不是 agent 对 v0.2.9 重新进行的真实发送验证。

历史查表样例，仅用于理解，不能当成实时权威数据：

| 柜号 | 当时 MBL | 当时 SSL |
| --- | --- | --- |
| MRSU4786640 | MAEU276301677 | MSK |
| MSDU6134964 | MEDUACU76689 | MSC |
| OOCU5696124 | OOLU2173421700 | OOCL |
| MSMU8984372 | MEDUYI141936 | MSC |

行号会变动。早期读取约 544 条，后来约 542 条，不要把它们当成当前固定总数。

## 4. 文件与职责

| 文件 | 职责 |
| --- | --- |
| manifest.json | MV3、模块 service worker、default_popup、权限 |
| app.html / app.css / app.js | 查询/配置/记录 UI、手填 MBL、预览、轮询、配置导入导出、清缓存 |
| core.js | 柜号/MBL/邮箱校验、模板渲染、航司识别、lookup、deduplicateRecords、cacheRecords |
| config.js | 配置默认值与严格校验、旧字段兼容、JSON 格式 |
| service.js | 串行业务流程、缓存、匹配、草稿/发送、操作锁、归档 |
| worker.js | Chrome storage/tabs/scripting 接口、持久化任务状态、消息来源限制 |
| kdocs.js | 注入顶层文档的独立函数 readKdocsPage，操作 AirScript UI、解析完整新日志 |
| gmail.js | 注入新建写信页的独立函数 gmailPage，填信/保签名/校验/发送确认 |
| airscript/LFD_ReadOnly.js | 在线只读脚本源码，提取柜号/MBL/行号/SSL |
| tests/*.test.js | Node 单元/业务/后台/配置/脚本测试 |
| tests/browser.html、browser.js | 模拟 DOM 的 Gmail/KDocs 适配器测试 |
| tools/serve.mjs | 本地预览服务，127.0.0.1:5179 |

注入函数必须保持自包含，不依赖模块闭包或外部 import 变量，因为通过 `chrome.scripting.executeScript({func})` 注入。

## 5. 实际数据流

### 查询与缓存

`app.js perform('identify')` → `worker.runOperation` → `service.run`。

`chrome.storage.local` 保存：

```js
{
  settings: { /* 配置 */ },
  sheetCache: {
    version: 1,
    key: JSON.stringify([settings.sheetUrl, account]),
    records: [{container, mbl, row, carrier}],
    readAt: /* 时间戳 */
  },
  ledger: { /* 防重复及邮件状态 */ },
  archive: [ /* 已解除锁定的历史记录 */ ],
  operation: {id, status, mode, container, options, time, result, error}
}
```

- 使用 Chrome 插件 storage.local，**不是独立 .json 文件，也不是网页 window.localStorage**。
- 页面 localStorage 仅用于记住 popup 输入和 localhost 演示配置。
- 仅有一份最近的快照。文档+账号不匹配则视为未命中，并不是每个文档都保留一份数据库。
- 读取已有快照时运行 `cacheRecords`，删除不完整项、重复项并保存清理结果。
- 未命中时先 `sheetCache:null`，随后查表，校验后保存过滤后的完整快照。
- `deduplicateRecords` 选最小 row 的非空 MBL/SSL 行。没有完整行时其内部保留原组用于 lookup 报错；`cacheRecords` 再过滤，所以最终存储中不会保留这些不完整组。
- 新读取的原始数据仍可用于本次匹配/手工补填，**缓存内容与本次临时读取对象不完全相同**。
- 不自动过期，无 TTL，无定时同步，无负查询缓存；一个始终不存在的柜号每次查询都会再次读表。
- UI 查询按钮不强刷。service 的 `forceRefresh` 参数仍保留，但 UI 不传 true。
- 清缓存：worker 拒绝任务运行期间清理；写入 `{sheetCache:null, operation:null}`。清理后下一次查询才读表，不立即读表。
- `unlimitedStorage` 解除默认 storage.local 配额，但不是无限磁盘或无限性能。

### 金山文档

没有用户提供的 API/AirScript HTTP 授权。当前用已登录页面和 AirScript UI，不抓取密码、Cookie 或私有 API token。

worker 每次需要查表时创建**自己拥有的后台标签**（active:false），不复用用户正在操作的表格标签，finally 关闭临时标签。Chrome/worker 被异常终止可能留下标签。

适配路径：效率 `#ToolsTab` → 高级开发 button → `[role=option]` 或 menuitem 的 AirScript脚本编辑器 → `#excelIde` iframe → `.title-content` 的“我的脚本” → `LFD_ReadOnly_v1` → `#run-script`。

曾修复的真实问题：

- SVG 内 style 文本污染 textContent，导致按钮匹配失败；可见标签匹配使用 innerText。
- AirScript 菜单外层 div 和真实选项有相同文字，点外层无效；必须选 action 节点。
- “我的脚本”默认折叠；必须点 `.title-content`，不要点外层 `.listItem`。
- 判断 `.listItem.open`，避免把已经展开但加载缓慢的列表又折叠。
- 等待脚本列表异步加载，不再固定等 350ms 就认定脚本未安装。
- 先确认脚本名和可见代码含 `LFD_`，不能运行默认选中的其他业务写入脚本。

线上脚本名称保持 **LFD_ReadOnly_v1**，但内容已升级为 **version 2 输出协议**。
脚本只读指定工作表，按表头识别列，跳过“取消DO/取消D/O”分段，遇到“已送仓”或“排程:”标题后继续读取（v0.3.1 起；旧版在取消DO处停止，导致已送仓分段读不到）；分批 500 行，保护上限 30,000 行/200 列。不写单元格、不排序、不切换表。

输出 START/CHUNK/END，同一个运行 id，CHUNK 最多 6 条且按长度切分；记录是 `[container,mbl,row,carrier]`，兼容旧 3 字段。
kdocs 适配器要求新的 START、同 id、分段连续、条数正确和 END；拒绝截断、损坏或混入其他运行的数据。

### 航司与模板

- 优先用表中的 carrier 对照配置 id/name/aliases；表中无值时可按 MBL 前缀识别。**不按柜号前缀判航司**。
- 内置 MAEU → Maersk、MEDU → MSC。未知非空航司、冲突、多重匹配会提示手选。
- 手选航司优先于自动识别。
- 默认正文：`Dear {{steam shipping line}},`、`Could you please advise the {{type}} LFD for the container below?`、`{{table}}`。
- 默认主题：`{{Type}} LFD Inquiry - Container#{{container}} MBL#{{mbl}}`。
- 还支持 `{{carrier}}`、`{{container}}`、`{{mbl}}`；type 小写、Type 首字母大写。
- 正文必须恰有一个 table，正文/主题必须有 type 或 Type，主题必须有 container/mbl。用户文本先转义后生成受控 HTML。
- 配置 JSON：`format: lfd-inquiry-config`，`version:1`，最大 256 KiB；导入始终开启测试模式，不导入缓存或操作记录。先预览摘要后应用替换。

### Gmail 与防重复

- worker 对 draft/send 强制 `useConfirmed:true`；无缓存且无手填 MBL 会停止，不自动查表。
- UI 发送时传当前 manualMbl；没有可用匹配记录时还需明确手选航司。手填不写回表格，也不写进快照。
- 测试模式默认 true，并由后台强制把 send 转 draft；真实 Chrome 设置可能已被用户关闭，不要假定当前仍是测试模式。
- 只创建自己的 Gmail 写信标签，保留 Gmail 自带 `.gmail_signature`。不修改用户已有邮件/草稿。
- 验证发件账号、主题、正文及表格；To/Cc 只要求配置中的地址都在（v0.3.15 起用户要求兼容其他自动抄送插件，额外 Cc/Bcc 不阻止）。签名缺失或账号不明确时停止。
- 保存正文 hash/requestId，发送前防止被其他扩展或人工修改后误发。
- 防重复 key：账号+柜号+MBL+航司ID+查询类型。旧三字段 Maersk Demurrage 锁仍兼容。
- 状态：preparing → draft → sending → sent；失败为 needs_review/uncertain，不自动重发。解除锁定时归档。
- 仅捕获 Gmail 明确发送成功提示，且 Gmail 随后自行关闭写信标签（撤消发送期结束）才标记 sent。插件自己不关闭发送标签，以免在撤消期内中断发送。
- 关闭 popup 不应中断后台流程；operation 持久化供重新打开恢复。worker 重启遇 running 只返回 interrupted 视图，不覆盖存储中的旧快照，以防状态竞态。

## 6. 工程进度与证据边界

| 版本 | 主要进展 |
| --- | --- |
| 0.1 | 初版 Maersk 查表+Gmail 草稿；真实测试草稿曾确认保存且保留签名，未由 agent 实际发送 |
| 0.2–0.2.1 | 航司/类型/模板/JSON、真实 popup、修复过窄布局 |
| 0.2.2–0.2.4 | 依次修复高级开发入口、编辑器菜单、“我的脚本”展开；隔离后台查表标签 |
| 0.2.5 | 持久缓存、发送不重查、手填MBL、取消额外Cc、替换模板token |
| 0.2.6 | unlimitedStorage |
| 0.2.7 | 柜号吸顶、输入框内按钮、按钮也缓存优先 |
| 0.2.8 | 按第一条完整行去重，仅删除本地重复项 |
| 0.2.9 | 不完整记录不缓存、旧缓存清理、配置页清缓存 |
| 0.3.20 | worker 消息来源校验忽略 #fragment（app.html#import 也是自己的页面），否则导入页所有请求被静默拒绝 |
| 0.3.17 | 弹窗里打开文件选择框会让 popup 白屏/关闭：#importLabel 点击时 chrome.tabs.getCurrent 为空（popup）则打开 app.html#import 新标签并 window.close()；#import 加载后定位到 #importSection |
| 0.3.16 | service 重复锁错误带 duplicate=[{key,container,status,time,requestId,running}]，worker respond 透传，app rpc 挂到 error.duplicate；#duplicate 对话框「强制重发」逐个 release(key) 后 perform(原 mode)。需要处理列表不限时间，新增「重新发送」= deleteTask + refill 查询页 |
| 0.3.15 | gmail.js recipientMismatch：只要求配置的 To/Cc 都存在，额外 Cc/Bcc 放行（用户明确要求）；prepare 时最多等 10 秒让收件人 chip 渲染完整再校验，错误信息列出缺少的地址 |
| 0.3.14 | one.js top 'open'：点 Continue 前查 .selected-status-icon 是否 offline、.start-chat 是否 disabled；点后等待 #embeddedMessagingFrame 或 .mtn-combile-block（维护）30 秒；已接回旧对话直接返回。chatOnly 仅在 #embeddedMessagingFrame 存在时注入样式（否则白屏）。用户真实 Chrome 中白屏的确切原因未复现（调试环境当时美国在线） |
| 0.3.12 | cosco.js 改为 payload.fields=[{label,value,kind}] 按标签依次填写（等待联动字段出现），verify 同样按清单。portalTemplate：Detention→support.cosco-usa.com 三个字段；On-Hire→portal.onHire.url（coscoshippingla.freshdesk.com）Type/Services/Region/Number of Containers/Container #/SCAC Code，正文用 carrier.onHire.bodyTemplate，{{table}} 起初为 'lines' 样式，用户要求改为与邮件相同的 Container#/MBL# 表格（v0.3.13）。COSCO 内置 onHire 正文 COSCO_ON_HIRE_BODY，若保存的是通用默认文案则替换为 COSCO 默认 |
| 0.3.11 | renderTemplates 支持 more（表格多行，{{container}}/{{mbl}} 逗号拼接），On-Hire 默认文案 ON_HIRE_BODY/SUBJECT_TEMPLATE（空模板回落默认）。service：more 允许 chat 与 on-hire，额外柜号只要在缓存中就校验船公司。UI：粘贴多柜号拆行、以首柜号 carrierId 为基准红框（.extra-row.mismatch）、#removeMain 删除首框后补位。ONE：出站气泡是 c-pilot-messaging-text-bubble，MAIN world 下 li.textContent 为空——必须用 TreeWalker 读文本（deepText），匹配用 includes；页面错误带 sent 计数回传以判 uncertain；markSent 支持 uncertain/needs_review/中断 → 用户核实已发送 |
| 0.3.10 | settings.mailClient 'gmail'(默认)/'system'。system 时 service 不起后台任务，直接生成 mailto（纯文本 bodyText，\r\n），entry.status='draft'、mailClient='system'、mailto；popup 用 a.click() 打开（需用户手势）；service.markSent 由用户确认已发送。UI 选择 system 时显示限制并 confirm |
| 0.3.9 | inquiryType 增加 on-hire（INQUIRY_TYPES 标题）。carrier.onHire={to,cc,subjectTemplate,bodyTemplate}，默认全空由用户填写，模板不强制 {{type}}。inquiryChannel：on-hire→email，COSCO on-hire→'cosco-onhire'（流程待用户提供，识别提示 coscoOnHire，发送拒绝）。messageTemplate 对 on-hire 使用 onHire 收件人与模板 |
| 0.3.8 | ONE 每浏览器只有一个 MIAW 对话（共享 localStorage，开着的窗口会写回会话），曾尝试按窗口隔离存储，用户改为：客服还在→追加到当前对话；客服结束/窗口关闭→新窗口新对话。worker chatTurn 串行 ONE 任务，liveChat 读 storage.session.chatTab 并查 'agent' 状态，已结束则关旧窗。live 模式在 prepareChat 内完成发送+等已读（deliver），发送后的失败经 sendChat 抛出→uncertain。openWork 建 focused:false 小 popup 窗口（右下角）。终止：service.cancel+关 tab；删除：service.releaseTask。inFrame 遇 tab 关闭立即失败 |
| 0.3.7 | worker floatTab：chrome.windows.create({tabId,type:'popup'}) 后再 update 尺寸（启动参数 --window-size 会覆盖）。COSCO captchaWindow 在 submit 前弹小窗、onFocusChanged 失焦时 notifications；成功关窗。ONE showTab 先注入 top 'chatOnly' 样式只留 #embedded-messaging；watchReplies 已读后轮询 'replies' 15 分钟，客服回复即通知；测试模式接入即通知。通知点击→showTab。openDraft 允许 running 任务并对 ONE/COSCO 用小窗 |
| 0.3.6 | service.run 不再整体串行：只有锁登记 serial；readOnce 合并并发读表；所有 draft/send 都是后台 job（返回 background:true，service.job(requestId) 可等待，active() 供 worker 标记中断），进度写 entry.step/running。worker runOperation 允许并发，只持久化最新 operation；新增 peek 消息查额外柜号。ONE 多柜号 options.more，每柜号一条消息、ledger 每柜号一条（chatMessage 各自），error.read 记录部分已读。UI：「进行中」页签、#addContainer 增加 .extra-row 输入框 |
| 0.3.5 | ONE 渠道 one-chat（one.js，按 frame 分 top/chat/calc 注入，world MAIN，allFrames 轮询）：Salesforce MIAW 在 one-line.my.site.com iframe，LWC 组件需 TreeWalker 遍历；FINISHED MY INQUIRY 在 cms-resources-*.one-line.com 计算器 iframe。每次查询先清 ChatInfo/chat_transcript_id/chat_historyShown/*_WEB_STORAGE/sessionOwner 并刷新以开新对话。成功=回执 Read。测试模式走到客服接入并填好消息不发送。客服空闲约 3 分钟会催、再 2 分钟超时结束 |
| 0.3.4 | kdocs.js LABELS 中英（繁体备用）：高级开发/Advanced Development、AirScript脚本编辑器/AirScript Script Editor、我的脚本/My Scripts；#ToolsTab 已选中时点击会收起工具栏，找不到入口则再点一次。英文界面实测读表与全新安装通过。新增界面语言时只需在 LABELS 加文字 |
| 0.3.3 | readKdocsPage(script) 自动安装/升级「我的脚本」LFD_ReadOnly_v1：比较代码中 `LFD build: N`，新建用分组的 .dropdown-version-left-btn + 命名输入框（回车，失败则 blur），代码经 iframe 的 monaco.editor model setValue + .kd-icon-save 按钮；编辑器本身也会自动保存，运行执行的是编辑器当前内容，LFD_START 带 build 供核对。找不到柜号：只查一次，<dialog id=notFound> 确定清空输入/再次查找重读；重开弹窗不自动重查。改脚本请同时递增 build |
| 0.3.2 | AirScript 日志是 rc-virtual-list，只渲染可见行：readKdocsPage 改为 world:'MAIN' 注入，从 .rc-virtual-list 的 React fiber memoizedProps.data 读全部日志（args），退回 innerText。缓存未命中读表失败不再清空 sheetCache（forceRefresh 仍清）。cosco.js 只写 .redactor_editor（真实页有隐藏 contenteditable）。联调方式：用独立 profile 启动 Chrome --remote-debugging-port=9333 --lang=zh-CN（C:\\Users\\AMERI\\AppData\\Local\\Temp\\lfd-debug-profile，用户已在其中登录金山并加载插件），Windows node 运行 CDP 脚本；主 Chrome 不能开调试端口 |
| 0.3.1 | 修复 CSNU5509665 查不到：表格在 B854「取消DO」之后新增「已送仓」分段（CSNU5509665 在第 886 行），旧脚本在取消DO处停止。改为跳过取消段、遇到已送仓/排程标题恢复。需同步在线 LFD_ReadOnly_v1。插件存储可只读解析 Chrome Default/Local Extension Settings/<扩展ID>/000003.log 取证 |
| 0.3.0 | COSCO 走 Freshdesk 工单网站（cosco.js）：自动填表，人机验证必须用户手动完成（已拒绝实现自动过 reCAPTCHA，勿添加），token 出现后自动 Submit；类型固定 Detention、正文用默认模板、AHIA 固定（可配置）；渠道字段 carrier.channel=email/cosco-portal + portal{requester,shipmentType,service,reference}。未真实提交验证 |
| 0.2.10 | 修复“记录已发送但实际未发、标签未关”：发送提示出现后还须等 Gmail 自行关闭写信标签（≤60s，worker.closedByGmail）才记 sent，否则 uncertain 并保留标签，可“打开写信页”；成功提示去掉“已发送邮件”匹配。75 项测试通过，未真实发信复测 |

- 74 项 Node 测试已在 v0.2.9 通过，覆盖新旧缓存过滤、去重行序、跨账号/文档隔离、手填、无重复查询、配置兼容、操作锁和清缓存保留配置/历史。
- 浏览器适配器模拟测试此前 15 项通过，含真实菜单嵌套/SVG/折叠延迟加载回归；并非 v0.2.9 全部真实线上测试。
- v0.2.5 本地 UI 已检查手动修改MBL同步预览；v0.2.7 实测滚动到底后柜号栏 top 与滚动区域 top 均为108，吸顶有效。
- v0.2.9 清缓存按钮已实现并有后台测试，但**尚无用户重载后真实安装版端到端确认，也未在这一版做浏览器按钮点击验证**。
- 线上 read-only 脚本已通过实际运行验证。source/readme/version 成功更新不等于 Chrome 已加载新版。

## 7. 未完成、已知限制、后续检查（不要未经要求扩大范围）

1. 等用户重载 0.2.9，验证真实缓存命中、不完整行过滤、清缓存后再次读取指定表格。只做草稿测试，除非用户另行明确授权真实发送。
2. **容量/原子更新暂未实现**：用户先前明确说只加 unlimitedStorage，其他暂不需要。仍没有容量显示、getBytesInUse 检查、淘汰策略、TTL、IndexedDB、缓存 JSON 导出或完整备份。不要当成本轮必须做的需求。
3. 读表前会先清掉旧缓存；失败就失去旧快照。用户已被告知，尚未授权改为安全替换。
4. 每次读整份缓存到内存并遍历，大量数据性能有限；本地持久记录/归档不自动清理。
5. **需关注新规则与旧推断的差异**：不完整SSL行不缓存，但本次 raw lookup 仍可能使用 MBL 前缀识别航司；UI 可能显示识别成功，而随后 send 从缓存找不到该行并要求手选。若用户反馈，复现后再统一 UX；本次只明确要求不缓存不完整行。
6. `deduplicateRecords` 按“非空”选择第一条完整行，不按“格式正确”跳过它；后续 mblNumber 验证会阻止非法 MBL，不能擅自改成挑后面的有效行。
7. 相同柜号无完整记录且缓存未命中会重复读表，无负缓存。符合当前“找不到才查表”的要求，但频繁查询不存在柜号会慢。
8. UI 手填值不会独立持久化；关闭重开可能恢复上次 operation 的数据而不是刚手改的值。尚未专门验证多 popup/关闭后手填恢复。
9. CSS/DOM 依赖站点结构。AirScript、Gmail 语言/页面变化会导致停止；不要以“测试全过”宣称未来兼容。
10. `tools/serve.mjs` 是开发预览，无真实 Chrome runtime 时 app.js 走演示数据，不证明在线查询/发信正常。
11. README 含一些旧版验证条目和历史描述；若后续重写，保留真实验证边界，不把用户截图等同于本机自动化复测。
12. 最新 zip 在编写本交接文件之前生成；zip 中未必包含本文件。交接文档以源目录及 outputs 副本为准。

## 8. 开发与验证命令

在源目录执行（PowerShell）：

```powershell
& 'C:\Program Files\nodejs\node.exe' --test tests/*.test.js
& 'C:\Program Files\nodejs\node.exe' --check app.js
& 'C:\Program Files\nodejs\node.exe' tools/serve.mjs
```

预览：`http://127.0.0.1:5179/app.html`；模拟适配器测试：`http://127.0.0.1:5179/tests/browser.html`。
无需 npm install。测试结束停止开发服务。旧预览 localStorage 可能有上次演示配置，不要把演示收件人当用户真实配置。

更新版本时同步 manifest.json、package.json、app.html 页脚，更新 README/outputs 安装说明，使用 Compress-Archive 将源目录内容打进 `outputs/lfd-inquiry-extension-vX.Y.Z.zip`，确保 zip 根部有 manifest.json。

在本会话使用的浏览器工具中，`chrome://extensions` 和 `chrome-extension://...` 页面受策略限制，安装/重载/点击实际 popup 由用户完成。不要用 CDP、shell 或其他手段绕过限制。HTTPS Gmail/KDocs 与 localhost 可用允许的浏览器工具检查。接手 agent 应遵守自己环境的当前工具规则。

用户不喜欢重复确认常规代码修改，但真实邮件测试不能擅自发出；涉及删除在线表格必须遵守明确范围。清本地缓存的按钮开发获授权，并不要求开发者现在把用户真实缓存清掉。

## 9. 交接后的建议第一步

询问/接收用户下一项具体任务；若只是继续验收，则请其确认 popup 版本0.2.9，测试一次已缓存完整柜号、一次不完整/重复柜号、清缓存再查询。记录实际现象后修复，不再重复从零研究已解决的菜单定位问题。


## 2026-10-20 v0.3.20 Foxmail compatibility
System mail uses labelled Container#/MBL# plain text, normalized CRLF, and semicolon-separated recipient lists. Gmail HTML is unchanged. Signature remains owned by the mail client. No actual mail was sent. Four targeted mailto tests pass; actual Foxmail compose rendering remains to be verified after reload.


## 2026-10-20 v0.3.20 Foxmail clipboard fallback
User screenshot confirmed v0.3.19 recipient separation works but Foxmail flattens mailto body line breaks. app.js now offers 复制格式化正文 for system-client drafts in both task/history lists. system-mail.js builds safe rich text from saved bodyText or legacy mailto body, preserving line breaks. clipboardWrite is added; clipboard is only written on explicit click. User must replace only inquiry text in Foxmail, leaving signature untouched. Six targeted tests pass, app.js syntax and git diff checks pass; live clipboard/paste validation not performed, no email sent.


## 10. 2026-11-02 v0.4.0（以本节为准，前文与之冲突处已过时）

- 配置结构：`profile={id,name,greeting,aliases,mblPrefixes,portal?,chat?,types:[{id,label,channel,to,cc,subjectTemplate,bodyTemplate}]}`。没有 `types` 的即旧格式，`core.js legacyTypes` 转换；发送方式在类型上（ONE 的 On-Hire 是 email）。COSCO 没有 demurrage 类型，`resolveType` 把 Demurrage 请求解析为 Detention。
- `settings.mode`（carrier/terminal）与 `settings.terminals`，码头无默认值，不做自动识别，`options.mode` 由界面传入。`defaults.js` 是用户提供配置经 `legacyTypes` 生成的纯数据。
- 取消 testMode、account：旧字段被接受并丢弃（`RETIRED_KEYS`）。主按钮真实发送。防重复键为 `[container,mbl,profileId,type]`；阻挡判断按记录内容比对，所以旧键（含账号）与最早的三段键仍生效。sheetCache 键不再含账号，升级后第一次查询会重读一次表。
- `mergeDuplicates`：id 或规范化名称相同的合并，保留配置更完整的一份并合并别名/前缀。app 在保存前拒绝改成同名，否则输入过程中会被合并。
- 自动保存：`scheduleSave`（400ms）→`flushSave`→`persist`（串行）；校验不过的内容写入 localStorage `lfd-config-draft`，重开恢复。保存不重绘表单。worker 不再在任务运行时拒绝保存；`refreshState` 只在首次读取时覆盖 `settings`。界面位置在 localStorage `lfd-popup-ui`。
- 导入只保留粘贴：弹窗内系统文件框会白屏（见 v0.3.17），`#import` 页已删除。
- gmail.js 收件人校验：`fieldAddresses`（chip、同名 input）∪ `recipientArea`（整个 form 克隆后去掉正文/签名/from，逐文本节点取地址，不可用 textContent，否则相邻地址粘连）。缺失时点 `.aoD.hl` 展开。**展开选择器和合并行结构未在真实 Gmail 验证，只有 tests/browser.js 模拟**。用户确认没签名不重要：等待签名最多 4 秒，没有也继续；有签名时仍校验未被改动。
- Chrome 浏览器测试：`tests/browser.html` 24 项模拟通过；配置页在无头 Chrome 的本地演示模式下验证；另在临时配置的无头 Edge 中以已加载扩展、标签页方式打开 app.html，验证了空存储内置配置、旧配置升级与重复合并、经 worker 的自动保存、重开恢复、码头、删除、粘贴导入。工具栏弹窗本身和真实 Gmail 未验证。


## 11. 2026-11-02 v0.5.0 实验性 Auto CC

- `gmail-autocc.js` 是常驻 mail.google.com 的 content script（经典脚本，非模块），未开启时只取一次配置。`settings.autoCc={enabled,senders,cc}`。
- storage 是 TRUSTED_CONTEXTS，content script 读不到，所以由 worker 转发：`autoCcConfig`（只返回这一段）、`autoCcOpen`；worker 的 onMessage 对这两个类型单独放行，其余消息仍只接受 app.html。`storage.onChanged` 把变化推给 Gmail 标签页，app.js 也监听它实现多窗口同步（`pendingWrites`/`saveTimer` 期间跳过，避免自己写入的回声）。
- `autoCcOpen`：`storage.session.openTarget` + `chrome.action.openPopup()`，失败开小窗口；app 通过 `state.openTarget` 定位。
- 发件人：`input[name=from]`，否则 document.title；有 From 选择器但无值时视为未知，不添加。`view=cm` 页面跳过（插件自己的 LFD 写信页，否则会和 gmail.js 校验抢输入框）。`handled` 记录已处理地址，手动删除不再加回。
- 2026-11-02 已在真实 Gmail（调试 Chrome，amerihua.op001）验证：新邮件、回复、发件人不符静默、按钮位置与开关同步、LFD 草稿不受影响，均未发送，测试草稿已舍弃。实测结论：`.aoD.hl` 点击打不开，要用 Ctrl-Shift-C 快捷键（对正文派发 keydown）；地址要 insertText + Enter 才成 chip，逗号不行；有两个 aria-label=Gmail 的 logo，一个在屏幕外；LFD 写信页 URL 被 Gmail 改写成 `?fs=1&to=…`，没有 view=cm。
- 调试方法：`--remote-debugging-pipe --enable-unsafe-extension-debugging` + CDP `Extensions.loadUnpacked`；这样装的插件一旦 reload 就被屏蔽，要 uninstall 再 load。Google 不允许在调试模式下登录，需先用普通模式在同一 profile 登录。


## 12. 2026-11-02 v0.6.0 改名与多语言

- 改名 Trucker Helper。保留：配置 `format: lfd-inquiry-config`、localStorage 键 `lfd-*`、脚本名 `LFD_ReadOnly_v1`，它们是数据或内部名。COSCO 的 reference 默认改为空（v0.6.1，用户决定），为空时工单不填该字段；已保存或导入的精确值 AHIA 在读取时清除。真实 COSCO 表单上该字段带 * 号，未实测空值能否提交。
- 多语言不改各模块的中文文案：`i18n-strings.js` 是 [中文, en, es] 表，`i18n.js translate()` 整句/占位符匹配，拼接句退回片段替换。`i18n-dom.js` 用 MutationObserver 翻译页面上所有文本和 title/placeholder/aria-label，记住中文原文以便切换；跳过 `#mailBody`、`#subject`、textarea。worker 通知在 `notify()` 翻译；`confirm` 在 app.js 包了一层。
- 新增或修改任何中文提示都要同步 `i18n-strings.js`，`tests/i18n.test.js` 会扫描源码，缺翻译就失败。
- `settings.language` 为 '' 时跟随浏览器（zh*→中文，es*→Español，其余 English）。
- 调试 Chrome 里 uninstall+load 同 ID 后，service worker 仍是旧脚本：要先在插件页 `navigator.serviceWorker.getRegistrations()` 全部 unregister 再重装。
