# LFD Inquiry — Agent 交接文档

更新时间：2026-10-09（America/Los_Angeles）。代码版本：**0.3.4**（英文界面兼容；2026-10-14：发送确认加严、COSCO 工单网站、取消DO 后分段读取、日志虚拟列表读取、脚本自动安装、找不到柜号提示框，见第 6 节）。
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
- 验证发件账号、To/Cc、无意外 Bcc、主题、正文及表格。签名缺失或账号不明确时停止。
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
