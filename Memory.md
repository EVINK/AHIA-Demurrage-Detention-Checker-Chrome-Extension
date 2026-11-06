# Trucker Helper: handoff for agents

Formerly "LFD Inquiry". Written at v0.6.2, updated for the Vue rewrite at v0.7.0. `agent.md` holds the older detailed history in Chinese; where the two differ, this file wins.

## Purpose

A Chrome extension (Manifest V3) for a trucking operations team. The user pastes a container number; the extension finds its MBL and carrier in a KDocs (金山文档) sheet, then prepares an inquiry to that carrier. The extension does not obtain the LFD (last free day) itself: it sends the question and a human reads the reply.

Inquiries go out by Gmail, by the COSCO ticket website, or by ONE's live chat. An experimental Auto CC feature adds Cc addresses to ordinary Gmail compose and reply windows.

## Rules that must not be broken

- Never send a real email, submit a real ticket or contact a real agent in testing without the owner's explicit permission. Use draft mode. Note that ONE's "draft" reaches a real human agent.
- Never write to the KDocs sheet. The extension only reads it.
- Never type the owner's credentials or solve a captcha. COSCO's reCAPTCHA is always solved by the user. One exception the owner asked for (11/6): the OOCL account the owner saves on the config page, which the plugin types into OOCL's own sign-in page (see v1.1.0).
- The main button really sends. There is no test mode any more.
- Email templates and content are never translated.
- Injected page functions (`gmailPage`, `coscoPage`, `onePage`, `readKdocsPage`) must stay self-contained. They run through `chrome.scripting.executeScript({func})`, so they cannot use imports or closures.
- `gmail-autocc.ts` must stay free of imports: it is built as a classic content script.

## Architecture

Vue 3, TypeScript, Less and Naive UI, built by Vite as a plain multi-entry build into `dist/extension`. `dist/` also holds old release zips, so the build must never empty `dist/` itself.

```
app.html                      Vite entry for the popup
src/app/main.ts               Mounts App.vue
src/app/App.vue               Naive UI providers and theme
src/app/Shell.vue             Header, tabs, footer, dialogs; sets up the in-app confirm
src/app/store.ts              All popup state and behavior
src/app/pages/*.vue           查询, 进行中, 配置, 记录: render the store, call its actions
src/app/app.less              Styles
src/background/worker.ts      Service worker. Chrome APIs, tabs, windows, notifications, message routing
src/core/service.ts           Business flow: lookup, locks, drafts, sending. Chrome-free, so unit tested
src/core/core.ts              Validation, template rendering, carrier recognition, schema migration
src/core/config.ts            Settings defaults, validation, JSON export and import
src/core/defaults.ts          Built-in 12 carriers (data only)
src/core/i18n.ts, i18n-strings.ts  translate() and the [zh, en, es] table
src/injected/gmail.ts         Injected: fills and verifies the LFD compose tab, clicks Send
src/injected/cosco.ts         Injected: fills the COSCO Freshdesk ticket, submits after the captcha
src/injected/one.ts           Injected into ONE's frames: live chat flow
src/injected/kdocs.ts         Injected: runs the read-only AirScript and parses its log output
src/content/gmail-autocc.ts   Content script on mail.google.com: Auto CC and its button
public/                       Copied as is: manifest.json, icons, _locales, airscript/LFD_ReadOnly.js
```

Native `confirm`, `alert` and `prompt` must not be used in the popup: they stop working when the user ticks Chrome's "prevent this page from creating additional dialogs". `ask()` in `store.ts` opens a Naive UI dialog, and a test fails on native calls.

Modules under `src/core`, `src/injected`, `src/content` and `src/background` carry `// @ts-nocheck`: they were moved as they were, and TypeScript is non-strict. Injected functions are minified by the build and still serialized by Chrome, which was verified on real Gmail and KDocs.

Flow: `store.ts perform()` → `chrome.runtime.sendMessage` → `worker.runOperation` → `service.run`. Draft and send are background jobs: `service.run` returns at once with `background:true`, and progress is written to ledger entries (`running`, `step`), which the 进行中 page polls.

## Storage

`chrome.storage.local`, access level `TRUSTED_CONTEXTS`, so content scripts cannot read it. Gmail gets only the Auto CC part, through the worker.

| Key | Content |
| --- | --- |
| `settings` | See below |
| `sheetCache` | `{version:1,key:JSON.stringify([sheetUrl]),records:[{container,mbl,row,carrier}],readAt}` |
| `ledger` | Duplicate locks and task state, keyed `JSON.stringify([container,mbl,profileId,typeId])` |
| `archive` | Released ledger entries |
| `operation` | The newest lookup or send, so a reopened popup can restore it |

`chrome.storage.session`: `chatTab`, `openTarget`.

Page `localStorage`: `lfd-popup-input` (query fields), `lfd-popup-ui` (page, selection, scroll, open sections), `lfd-config-draft` (text that could not be saved yet), `lfd-language` (last language, avoids a flash on open), `lfd-demo-settings` (demo only). These keep the `lfd-` prefix on purpose.

### Settings schema

```js
{
  sheetUrl, gmailIndex,           // gmailIndex is the /u/N/ account Gmail opens
  mode: 'carrier' | 'terminal',
  carriers: [Profile],            // 1 to 50
  terminals: [Profile],           // 0 to 50, none built in
  defaultCarrierId,               // 'auto' or a carrier id
  defaultInquiryType,
  mailClient: 'gmail' | 'foxmail' | 'outlook',
  autoCc: {enabled, senders: [], cc: []},
  language: '' | 'zh' | 'en' | 'es'  // '' follows the browser
}

Profile = {
  id, name, greeting, aliases: [], mblPrefixes: [],
  portal?: {requester, shipmentType, service, reference, onHire: {url, type, service, region}},
  chat?: {firstName, lastName, email, country, message},
  types: [{id, label, channel, to: [], cc: [], subjectTemplate, bodyTemplate}]
}
```

Built-in type ids are `demurrage`, `detention`, `on-hire`. Custom ones are `type-xxxxxxxx`. New profiles use `carrier-xxxxxxxx` or `terminal-xxxxxxxx`.

## Config format and migrations

Export envelope: `{format:'lfd-inquiry-config',version:2,settings}`, 256 KiB at most. Versions 1 and 2 import. `format` keeps the old name so existing files stay valid.

Everything migrates on read, in `normalizeCarriers` and `validateSettings`, so nothing depends on a migration step having run. The stored data catches up at the next save.

| Old data | Becomes |
| --- | --- |
| Profile without `types` (top-level To, Cc, templates, plus `onHire`) | One entry per type, see `legacyTypes` |
| Keys `account`, `testMode`, `extraCc` | Accepted and dropped (`RETIRED_KEYS`) |
| Same carrier saved twice, by id or normalized name | Merged, keeping the better-configured entry and all aliases and prefixes |
| A default carrier pointing at a merged entry | `auto` |
| `{{greeting}}` in templates | `{{steam shipping line}}` |
| `mailClient: 'system'` | `foxmail` |
| Type on `cosco-portal` or `one-chat` for any carrier other than `cosco` or `one` | `email` |
| Generic On-Hire text on an old COSCO entry | COSCO's own wording |

A version 1 file does not mention terminals, mode, Auto CC or language, so those keep their current values on import.

## Channels

`type.channel` decides how an inquiry goes out, per type. `channelsFor(profileId)` limits the choice: `cosco-portal` belongs to id `cosco`, `one-chat` to id `one`, and everyone else has only `email`.

**email.** Gmail web by default. The worker opens `/mail/u/N/?view=cm&fs=1&to=&cc=&su=`, which Gmail rewrites to `?fs=1&…`, then injects `gmailPage`. Send is confirmed only by Gmail's notice and then Gmail closing the tab; anything less is recorded as `uncertain`. Foxmail and Outlook use `mailto:`; the user sends and clicks 我已发送.

**cosco-portal.** Detention goes to support.cosco-usa.com, On-Hire to coscoshippingla.freshdesk.com. The user solves the captcha in a small window and the plugin clicks Submit. COSCO has no Demurrage type: `resolveType` turns a Demurrage request into Detention. `portal.reference` (PD INV /BL /BKG /HOU # /SCAC Code) is required for Detention since v0.9.3: `missingConfiguration` reports `reference`, the query page blocks the group and its 配置 button opens the config page on that field, highlighted. On-Hire's SCAC Code stays optional and is skipped when empty.

**one-chat.** Runs on one-line.com: form, menus, transfer to agent, one message per container, done when each shows Read. ONE allows one chat per browser, so tasks queue and append to a live chat. On-Hire for ONE is email.

Several containers in one message (`supportsManyContainers`): every email type, ONE chat, and COSCO On-Hire. COSCO's Detention ticket takes one container. Since v0.8.0 Demurrage and Detention work like On-Hire: each extra row is looked up for its MBL and carrier, rows of another carrier are marked and block sending, and one email carries all containers in `{{table}}`, with `{{container}}` and `{{mbl}}` joined by commas.

One-off edit (v0.9.8, COSCO / ONE since v0.9.13): an email group's To / Cc / subject / body can be changed for one send from the query page (`options.edit` → `messageTemplate`); a COSCO ticket or ONE chat takes the body only (`portalTemplate` / `chatTemplate` with `options.edit.body`). Settings and templates are never changed by it.

Duplicate lock: container + MBL + profile + type. The check compares entry contents, so old key formats (with the account, or the earliest three-part ones) still block.

## Auto CC

Off by default. `gmail-autocc.ts` runs on every Gmail page but does nothing until enabled.

- Applies to any compose or reply form whose sender is on `autoCc.senders`. Otherwise it stays silent. The sender is `input[name=from]`, then the address in `document.title`; if a From selector exists with no value, the sender counts as unknown.
- Skips pages with `view=cm` or `fs=1`, the LFD compose tab, whose recipients `gmail.js` is verifying.
- Facts from real Gmail, do not change without testing: clicking `.aoD.hl` does not expand a reply's recipients, so use Ctrl-Shift-C dispatched on the message body. A comma does not make a chip, Enter does. There are two `a[aria-label="Gmail"]`, one off-screen. Cc chips are `[role=option][data-hovercard-id]`. Hidden `input[name=from]` is empty on this account. A compose form has `input[name=composeid]`.
- Worker messages `autoCcConfig` and `autoCcOpen` are the only ones accepted from a Gmail tab. `storage.onChanged` pushes changes to open tabs.
- `autoCcOpen` reuses an open plugin page (`runtime.getContexts`), otherwise calls `action.openPopup()`, otherwise opens a small window. `openPopup` fails when the Chrome window is not focused.

## i18n

Chinese is the source text in the code. `i18n-strings.js` has `[zh, en, es]`, with `{}` for values in the key, `{0}` in translations, and `{0l}` for lower case.

`translate()` tries an exact match, then a whole pattern, then replaces known pieces. So messages from any module need no change: components render `t(text)`, which is reactive on `language`, and the status line stores the Chinese source so it follows a language change. Notifications are translated in `worker.ts notify()`. Naive UI's own strings follow `NConfigProvider`.

The browser decides when `settings.language` is empty: `zh*` → 中文, `es*` → Español, anything else → English.

`tests/i18n.test.js` scans the source and fails when a Chinese message has no translation. Add new messages to the table in the same change.

## Testing

Node is the Windows one, reached from WSL. npm must run through it too:

```bash
NODE="/mnt/c/Program Files/nodejs/node.exe"
"$NODE" 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' install
"$NODE" --test tests/*.test.js                       # 140 tests; Node 24 runs the .ts modules directly
"$NODE" node_modules/vue-tsc/bin/vue-tsc.js --noEmit # type check
"$NODE" node_modules/vite/bin/vite.js build          # dist/extension
"$NODE" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5179
```

Then open `/app.html` (demo mode, sample data, no real services), `/tests/browser.html` (Gmail, COSCO and KDocs adapters against simulated pages, 25 tests) and `/tests/autocc.html` (10 tests). The last two take a minute and report PASS or FAIL lines on the page. Simulations do not prove real Gmail behavior: real runs found six bugs they had missed.

**See test results before committing or pushing.** Do not chain tests and push in one command. Twice a push went out with a failing test that way.

### Real browser

Use a separate profile, never the owner's main Chrome: `%LOCALAPPDATA%\Temp\lfd-debug-profile`. It is signed in to the owner's Gmail and KDocs, and the owner asked to keep it.

- Branded Chrome ignores `--load-extension`. Start it with `--remote-debugging-pipe --remote-debugging-port=9333 --enable-unsafe-extension-debugging` and call CDP `Extensions.loadUnpacked` over the pipe. The id comes from the path: `ogahehoddpfcnnnhhcefjoccphbipphl` for `demurrage-lfd-extension-vue\dist\extension`, `mmkikpfgoippjafbblecbnoanojmlham` for the old unbuilt folder.
- An extension loaded that way is blocked (`ERR_BLOCKED_BY_CLIENT`) after any reload. Use `Extensions.uninstall` and load again.
- After reinstalling, the service worker can stay on the **old script**. Run `navigator.serviceWorker.getRegistrations()` on a plugin page and unregister before reinstalling, or results describe old code. Confirm with `Debugger.getScriptSource` when in doubt.
- Google refuses sign-in while debugging is on ("此浏览器或应用可能不安全"). Sign in by starting the same profile without debug flags, then restart with them. The session survives.
- Discard test drafts with Gmail's 舍弃草稿 button.
- The owner's real settings can be read, without changing anything, from a copy of `Default/Local Extension Settings/<id>/`. `000028.log` is a LevelDB log: strip the 7-byte fragment headers, then decode the JSON. Keys are sorted, so `aliases` comes before `id`.

## Reloading

Layout since 2026-11-03 (owner: keep only the Vue 3 version):
- `C:\Users\AMERI\Documents\workspace\demurrage-lfd-extension` holds only the git store: `.git` with `core.bare=true` plus a README. The old non-Vue files are gone (still in history). Never delete it: both worktrees below use its `.git`.
- `...\demurrage-lfd-extension-vue`: worktree on `refactor/vue3-naiveui`, the code in use. Load unpacked from its `dist\extension` after `vite build`; release zips stay in its `dist\`.
- `...\demurrage-lfd-extension-chagui`: worktree on `feat/experimental-chagui`, another workstream (automated container checking). Do not touch.
- GitHub has `main` and `refactor/vue3-naiveui`, both at the same commit when this was written; `fix/gmail-send-confirmation` is deleted (all its commits are in Vue history). `workspace\releases` is empty.

1. Build.
2. `chrome://extensions` → Trucker Helper → refresh.
3. Refresh open Gmail tabs, or content scripts stay old.

Until step 2, the page can load new files while the worker runs old code, which shows up as errors such as `配置包含不支持的字段：mode`. Bump the version on any fix so the footer shows which code is live.

An unpacked extension's id comes from its folder, so the Vue build has a different id from v0.6.x and its own `chrome.storage`. Settings move by 导出 JSON in the old plugin and pasting into 导入 in the new one. History and duplicate locks do not move. Remove the old plugin afterwards, or Auto CC runs twice.

## Changelog

### Changelog tab (rule, owner 11/6, since v1.3.0)

**Every version bump must add an entry to the 更新日志 tab.** Entries are data in `src/app/changelog.ts` (`CHANGELOG`, newest first): `{version, date, items:[{title, text, jumps?}]}`; the page `src/app/pages/ChangelogPage.vue` only renders them. Add the new entry at the top of the array in the same change as the version bump, with `version` equal to the manifest version. A new feature must get jump buttons (`jumps:[{label, target}]`) that take the user to where the feature lives; `target` is handled by `openFeature()` in `store.ts` (`matson`, `chagui`, `autoCc`, `ooclConfig`, or any page name such as `query`, `tasks`, `config`, `history`, `labs`). A feature in a new place needs a new target there. Titles, texts and labels are Chinese sources: add their English and Spanish to `src/core/i18n-changelog.ts` (the i18n test fails otherwise). Small fixes can be one short item without buttons. This list below stays the detailed history for agents; the tab is the user-facing summary.

**v0.4.0.** Fixed the false "Cc 缺少" error: verification now reads the whole recipient area. Config page auto-saves with a local draft, and reopening restores the page, selection and scroll, because the popup closes when the user copies text from elsewhere. One config per carrier, with duplicates merged, because unsaved state used to create extra carriers. Per-type settings and custom types. Paste import, because the system file picker blanks the popup on Windows. Removed test mode and the sender account check. Default Cc for new carriers and types. 12 built-in carriers and restore defaults. Terminal mode. Simplified the config page.

**Gmail signature (between v0.4.0 and v0.5.0).** A missing signature no longer stops sending, because any account may send. An existing signature is still kept and checked.

**v0.5.0.** Experimental Auto CC.

**v0.5.1.** Waits out redirects before reading a tab, retries when a tab sits on a site outside the manifest, and shows a Chinese explanation instead of Chrome's raw "Cannot access contents of the page". Fixed a second plugin window overwriting the remembered position. Auto CC fixed against real Gmail: Cc row by shortcut, Enter for chips, the right logo, caret restored, and the LFD compose tab skipped after a test address leaked into a draft. Recipient expansion in `gmail.js` also moved to the shortcut.

**v0.5.2.** Auto CC button keeps 14px from the search box, because it touched it. Clicking it reuses an open plugin page and ignores double clicks, because repeated clicks opened several windows.

**v0.6.0.** Renamed to Trucker Helper and removed the AHIA branding. English and Spanish, following the browser language until the user picks one.

**v0.6.1.** COSCO reference is optional and empty by default, and the old `AHIA` value is cleared, by the owner's decision.

**v0.6.2.** Only COSCO and ONE can pick their own channels, with saved mismatches returned to email. Trigger: the owner's EMC Demurrage type was set to ONE chat through a dropdown that offered it, so EMC's editor showed ONE chat alongside EMC's aliases, which looked like corrupted ONE data. ONE's data was intact. EMC inquiries would have gone to ONE's chat. Also fixed a draft surviving its own save when the user switched carrier straight after.

**v0.7.0 (branch `refactor/vue3-naiveui`, not merged).** Rewritten with Vue 3, TypeScript, Less and Naive UI on a Vite build. Native dialogs replaced by in-app ones, because they break once the user blocks them. Behavior, schema and storage keys are unchanged.

**v0.7.1 (same branch).** UI pass: header controls share one height, delete actions and the search button are real Naive UI buttons, all inputs and selects are 30px. Repeated hints removed: the status bar is empty at rest and shows only what is happening, each piece of help appears once.

**v0.7.2 (same branch).** The Windows default apps link is plain text now. Its `ms-settings:` URL made Chrome ask to open the Settings app, and the link sat right above the Auto CC section.

**v0.7.3 (same branch).** The Windows default apps link is back at the owner's request. Chrome's own prompt before opening the Settings app cannot be replaced by a plugin dialog; it stays, and "Always allow" stops it.

**v0.7.4 (same branch).** ONE chat start: 45 seconds, then the window comes forward with a notification and Continue is tried once more for 45 seconds. A failure stores `diagnostics` on the ledger entry (visibility, focus, clicks, Salesforce script state, page and load errors, reloads, network), shown under 记录 and included in 导出记录. Reason: "ONE chat did not appear" happened on the owner's machine with Chrome in the foreground, while ten measured runs took 1 to 4 seconds in every window state, so the cause is unknown and needs data. Page visibility is not it: ONE's `isAgentAvailabilityCheckEnabled` is false, and the launcher has no visibility logic.

**v0.7.5 (same branch).** Second ONE failure mode: Continue works and `#embeddedMessagingFrame` exists, but its page never loads within 45 seconds. The window is white because the small-window style hides ONE's page around that empty frame. `retryBlankChat` reloads the page up to 5 times, by the owner's decision; it stops at the pre-chat form, so no message can go out twice. Failures carry one `diagnostics.attempts` entry per try, with the frames seen, page state and window, and the style is removed so ONE's page shows. The chat frame ends at `/ESWOneMessaging…/?lwc.mode=prod&redirect=false`, and `Page.getFrameTree` does not show it: use `chrome.scripting` with `allFrames`. T icons. Why the frame stays empty is still unknown. The agent wait no longer times out at 10 minutes: `waitForAgent` runs until an agent joins, the window closes, the chat ends, it stops answering or 2 hours pass, showing ONE's queue line if there is one. State is in `chrome.storage.session` (`oneWait`), and a one-minute alarm or opening the popup lets a new worker resume. `phase` protects the single send: after `sending` the message is never sent again, and such a task becomes uncertain. The queue text match is a guess, since no real queue has been seen.

**v0.7.6 (same branch).** The wait for ONE's Read receipt is 15 minutes, up from 5: a slow agent left a message at Sent and asked the owner to verify by hand.

**v0.7.7 (same branch).** A run that recovered after reloads keeps `recovery` on its ledger entry, shown in 记录 and in the export, so data on the blank page builds up without a final failure.

**v0.8.0 (same branch).** Demurrage, Detention and custom email types take several containers, the same way as On-Hire, at the owner's request.

**v0.8.1 (same branch).** Query page groups pasted containers by carrier (cards with channel, recipients, rows, per-group carrier override, preview, send/draft; send-all runs groups in order). Unresolved rows (not found, no MBL, unconfigured carrier) sit on top with inline MBL/carrier fixes and are never sent. `{{s}}` template token pluralizes; templates equal to the former defaults migrate (`FORMER_DEFAULTS` in core.ts). COSCO tickets take one container each and queue through `ticketLine` in service.ts.

**v0.8.2 (same branch).** The COSCO On-Hire ticket takes all containers of the group again; only Detention tickets go one per container, the owner's correction of v0.8.1. A carrier passed explicitly (`carrierId`) skips the extra-container carrier check; only `auto` checks.

**v0.9.0 (branch `feat/experimental-chagui`, off v0.8.2, own worktree `demurrage-lfd-extension-chagui`).** 实验性功能 tab with a 查柜 button, steps 1–3 of the owner's manual container check, all in background tabs (`src/background/chagui.ts`, page `LabsPage.vue`, state `labs.ts`). (1) Runs the 提柜表's own document-shared AirScript `ListA_Push 推送Available V2` (it has the authorized 云文档 API service; a copy is in `public/airscript/ListA_Push.js`), waits for its `List A 已写入：` log line, then reads Available V2 in the template sheet with the read-only `TH_ReadV2` (installed into 我的脚本, "TH build" marker, TH_START/CHUNK/END log). Counts must match or nothing is cached. This is the first time the plugin causes a sheet write (ListA_Push writes Available V2), at the owner's request. (2) Cache `chaguiCache` uses the owner's existing cache format (schemaVersion 1, per container `inLatestTemplate`, `lastObservedStatus`, `lastVerifiedApplied`, `position`, `pendingReview`, plus `runs`), so the Codex cache file imports by paste. (3) Opens app.draydog.com and reads the signed-in user; when signed out, brings the login page forward and waits 10 minutes. Run state `chaguiRun`; a run is owned by the worker instance, so one left `running` by another worker is marked interrupted.
Facts found: `src/injected/airscript.ts` is a generic AirScript runner. A workbook with no document scripts opens the editor on a welcome page without `#run-script` until a script is selected. The log panel cuts each entry's text at about 1000 characters, so TH_ReadV2 prints 25 containers per line; long logs become a virtual list whose full data is in React props. Dray Dog: REST API at https://api.draydog.com (public OpenAPI at /openapi.json); the web app keeps the token in localStorage `auth_header_info` `{header:"Bearer …",orgID}` (`auth_headers_by_org_id` is empty for this account). Container data, holds, LFD, appointments, Deck evidence are all in `GET /containers/?container_numbers=…`; see `docs/v0.9.0-查柜第4-15步调研.md`. Owner's rules for later steps: Draydog CSV download is not required, any method that reaches the same result is fine; update each container's own row with the latest data (appointment, LFD, ETA…), but moving rows must never overwrite other rows' data.
**v0.9.0, continued (same branch).** The whole 15-step flow. Two buttons: 预览 runs up to the plan (no Start Tracking, no writes); 查柜 runs everything. Steps: 4 `POST /containers/watch/` for `unwatched_containers`; 5 `GET /containers/?container_numbers=…` (100 per request) plus a second query with `needs_line_lfd_check=true`; 6 `TH_ReadPickup` (read-only, 我的脚本) reads 提柜 A–P; 7–13 `src/core/chagui-rules.ts` (`observe`, `targets`, `plan`); write with `TH_Apply` (我的脚本, replaced every run with this run's PAYLOAD); 14 read again and compare (`verify`); 15 `recordObserved` / `recordRun` into the cache in the owner's field names.
提柜 layout (11/3): row 2–3 headers; A 放行 ✔, B 运输/扣留/查验信息, C MBL, D 柜号, G 摆置, H 车架, I 所属, J LFD 注记, K LFD (date serial, mm/dd), L PIN formula, M 预约日期 (serial), N 预约时段 (day fraction, hh:mm), P 码头. Section markers: "排程: mm/dd" rows (D), "未排程 ↓" (D), "按码头排" (B, inside 未排程), "未放行 ↓" (D), "取消DO" (B), "已送仓 ↓" (D). A container can have a note row under it with only B filled; such rows are not moved automatically.
Rules decided from the owner's text and the Codex cache: only Appointed (`import_appt_booked`) and Bookable (`import_appt_booking`) are written. Owner, 11/4: every Appointed / Bookable container without a hold gets ✔ (Closed Area blocks too); Dray Dog's `available_for_pickup` is not used (FMS reports null, Bookable is often "not available" only for lack of an appointment). Otherwise A is blank, never ✖. B: the plugin adds and removes only its own words (Custom_H, Line_H, Freight_H, TMF_H, CTF_H, …, Closed_Area; CEX added once), everything else in B stays. LBCT's "Customs BL Genereal Release" counts as Custom_H (LBCT says NO (HOLD), the team marks it so); "Customs Status Unavailable" does not. G/H from Deck evidence in any source value (not keys: one key is literally "Wheeled/Decked"), else wheeled, else Ground; manual H such as RENT stays. K = earliest of terminal LFD, line LFD and a note date ("SSL LFD 11/06"); when Dray Dog needs a line LFD check ("Check Line for LFD") the terminal date is ignored; unknown is blank. M/N for Appointed only, from the scheduled appointment in Los Angeles time. Rows below 未放行 move under 按码头排 after the last row of the same terminal, or at the end of that section.
Safety in TH_Apply: rows found again by D and checked by C (MBL); a duplicate container is skipped; each cell is written only if it still holds the value read; the move is checked after it lands. Tested against an in-memory sheet (tests/th-apply.test.js). First real write 11/3 16:46 with the owner's go-ahead: FFAU8773083, 4 cells and a move under 按码头排 LBCT, verified; the next preview found nothing left to change. The page has 预览 and 查柜并写表 (with an in-app confirm), added at the owner's request on 11/3.
Debugging: a reinstalled unpacked extension kept running its old service worker even after unregistering; loading the build from a fresh folder (new id) each time avoids it.

**v0.9.0, retry (same branch).** A failed step shows 重试: the run starts again from the failed step, reusing a finished ListA_Push line and, when read and cache also finished, the list read back; Dray Dog and later steps always run again. The owner hit "没有选中脚本" in their own Chrome on the read and write steps: the KDocs script list re-renders while loading, so a kept list element can be detached and never turn active. `airScriptPage` now looks the entry up again each time and clicks up to 4 times, and takes the editor's own model rather than the first model.

**v0.9.0, Auto CC moved (same branch).** At the owner's request (11/4) the Auto CC settings moved from 配置 to 实验性功能 (`#autoCcSection` in LabsPage.vue, same form fields and auto-save). The Gmail button and `showAutoCc` open the 实验性功能 page on that section.

**v0.9.0, hold keywords (same branch).** At the owner's request (11/4) the hold mapping is an editable list (实验性功能 → Hold 关键词), stored in `chrome.storage.local` `chaguiHoldRules` (defaults `DEFAULT_HOLD_RULES` in core/chagui-rules.ts). Each rule is `{match, by:'text'|'type', word}`: a Dray Dog hold is matched by its raw text first (case-insensitive), then by Dray Dog's hold type; `word` goes in column B, '' means not a hold. Owner words are managed in B like the built-in ones. When an Appointed / Bookable container has a hold no rule knows, the run pauses (`status:'waiting'`, `run.pending.holds`), sends a notification, and the page asks "当作 Hold（B 列写…）/ 不是 Hold"; the answers become text rules and the run continues. Dray Dog tags set by the team (e.g. TEST, 1H) go through the same list as `by:'tag'` rules: an unknown tag on an Appointed / Bookable container pauses the run the same way (owner, 11/4). The owner's three choices, in the notification and on the page: 1 不可提（添加关键词, with a column B word）, 2 可提（忽略, an empty word）, 3 暂停任务 (the run ends as an error; 重试 reuses the list and asks again). Clicking any 查柜 notification except the Draydog login one opens the plugin on 实验性功能 (`openPlugin('labs')`, `openTarget:'labs'`). While waiting, the worker calls `chrome.runtime.getPlatformInfo` every 20 s to stay alive; it gives up after 30 minutes.

**v0.9.1.** KDocs signed out: a shared sheet still opens, as a guest, without the script editor, so the read and 查柜 steps failed with "未找到 AirScript 编辑器". Both injected KDocs functions now check `window.__WPSENV__.user_id` first (a guest's starts with `fake_`; signed in it is the account number) and say "金山文档未登录" instead. Found by the owner in a private window, 11/4.

**v0.9.2.** 按预览写入: under a finished preview with changes, a button writes that preview's plan as it is (steps apply, verify, save; no new list, no Draydog). TH_Apply still checks each cell against the value the preview read, and a preview older than 30 minutes is refused. Owner's request, 11/4.

**v0.9.3.** COSCO reference: the v0.6.1 rule that cleared a saved `AHIA` also wiped the owner's own SCAC (AHIA) every time it was typed in, so the field looked unsaved. The rule is gone; the value is kept as typed. Detention now needs the reference: without it the query page shows it as missing and the 配置 button jumps to the field and highlights it; the worker refuses too. Owner's request, 11/4.

**v0.9.5.** Dray Dog badges as keywords (`by:'label'`): the "TMF (Pier Pass)" and "PortCheck: CTF" badges on a container card are not tags but the `pier_pass` and `clean_truck_fee` records. Each state becomes a keyword text such as `TMF (Pier Pass): no hold, fee paid` or `PortCheck: CTF: hold, fee unpaid`; a state never answered pauses the run like a new tag (owner: "遇到新的就弹窗", 11/4). Also: rows where only column D has a value are skipped by ListA_Push (plugin copy and list_a backup; the live shared script in KDocs is updated by the owner).

**v0.9.6.** Owner, 11/4: every new tag-like signal is asked about. `draydogSignals` (core/chagui-rules.ts) turns a container's other signals into `by:'label'` keyword texts: Pier Pass / CTF badges by state; holds from the other sources (eModal, Port Optimizer; the main source's copy is skipped), as `<source> hold: <text>`; status words and remarks in each source's extra data, as `<source> <key>: <value>`; fees owed (`<source> <key>: owed`); and "Appointment: no truck plate". The first preview asked about 10 such texts; the pause panel has 全部选可提 for that.

**v0.9.7.** Repeated containers. A container is matched only on business rows: above 取消DO, and not a row with a container in D and nothing else (`businessRows`, `onlyContainer`; TH_Apply build 2 does the same). Trigger: CSGU8059834 also sat on row 988 under 已送仓 with only column D filled, and the preview said "2 行，请人工确认" with no way to answer. When a container really is on several business rows, the run pauses (`run.pending.rows`, notification) and the page lists the rows (A, B, C, P, G/H, LFD, appointment) to pick one or skip; the pick travels as `pick` to TH_Apply, which writes that row and moves the row with the same MBL below 未放行.

**v0.9.8.** One-off mail edit on the query page. A quiet ✎ 编辑 under each email group's 预览 opens To / Cc / 主题 / 正文 for this send only; 恢复模板 drops it. The body is shown filled in, with the container table kept as `{{table}}` (`messageTemplate` returns `editableBody`). The popup keeps edits in `mailEdits` per group, keyed by type + containers + MBLs, so any change to the group drops the edit; it is passed as `options.edit` to `run` and `messageTemplate` swaps it in for the type's to/cc/subjectTemplate/bodyTemplate (`editedType`), never touching settings. The edit is cleared after the group is queued without failures. Edits apply to the email channel only (Gmail and mailto). Template `fill` now keeps unknown `{{tokens}}` as typed instead of writing `undefined`; a body without `{{table}}` (possible only in an edit) sends no table.

**v0.9.9.** v0.9.6 went too far: the owner wants only the badges the Dray Dog container card shows, not every API field (11/5). `draydogSignals` is replaced by `cardBadges`, which follows Dray Dog's own card code (the containers chunk, `calcBadges`: getReadyForPickupBadge, getLineLFDWarningBadge, getImportStatusDemurrageBadges, getPierPassBadges / getBadgesForFeeType, BOL badges, Trapac warning …) and uses the same wording: Not Ready For Pickup, CHECK LINE FOR LFD, `$ (demurrage)` for any dollar amount, TMF / TMF (Pier Pass) / PortCheck: CTF, BOL needed for booking, and so on. Tags and hold badges keep their own rules. Keyword texts from v0.9.5–v0.9.6 ("TMF (Pier Pass): no hold, fee paid", "lbct_api …") no longer match anything and can be deleted from the list.

**v0.9.10.** Owner, 11/5: 仍要发送 on a locked container row stays a text button (warning colour), only with some space on its left (`.resend-locked`, margin-left 10px). v0.9.8 had turned it into a bordered button, which the owner did not want. (v0.9.9 is the Draydog badge change.)

**v0.9.11.** Card badges: the Trapac "Reliability Issues" badge is in Dray Dog's code but not in calcBadges, so the card never shows it; removed (owner saw it asked for HMMU6571624). The new-word panel got spacing (.labs-pending styles) and the option reads "不可提（添加关键词） B 列写" without the comma.

**v0.9.12.** The new-word option reads just 不可提（添加关键词）; the column B word box stays next to it (owner, 11/5).

**v0.9.13.** Owner, 11/5: ✎ 编辑 also on COSCO and ONE groups, body only. COSCO: the ticket description is edited like a mail body (values filled, `{{table}}` kept), Type / Services / reference fields stay. Not offered for a COSCO Detention group with several containers, because each gets its own ticket and would all get the first one's text. ONE: one message per line, one line per container in order (`chatTemplate` rejects another line count). Store: `mailOf` builds any channel, `edit.mailOnly` marks an email edit; `editFields` sends only `body` for the other two.

**v0.9.15.** The 查柜 change table names each column: K（LFD）, B（查验信息）, A（放行）, G（摆置）, H（车架）, M（预约日期）, N（预约时段） (owner, 11/5).

**v0.9.16, Matson 查柜 (owner, 11/5; planned as v0.9.14, numbered after the v0.9.15 that landed first).** A second card in 实验性功能, 查 Matson 柜子, with 预览 / 查柜并写表 / 按预览写入 like 查柜. Files: `src/core/matson-rules.ts` (rules, tested in tests/matson-rules.test.js), `src/injected/matson.ts` (runs in a www.matson.com tab), `src/background/matson.ts` (flow, state `matsonRun`, notifications `lfd-matson`). Steps: read 提柜 with TH_ReadPickup; the Matson list is ListA_Push's own filter (above 取消DO, P = MATSON, A blank on every row of the container, not a bare container), i.e. exactly Available V2's MATSON column, so V2 is not read and no MBL column was added (C already holds the MBL; the live ListA_Push is unchanged). matson.com has JSON endpoints behind its pages: tracking `POST /wp-content/plugins/matson-plugin/Api_calls/tracking_booking_proxy.php` `{container_trackingnumber:<BL digits, MATS prefix dropped>, trackingVal:'tckbil', ttr:<#ttr on shipment-tracking.html>}` → per container events (epoch ms; the site shows them in Los Angeles time), vessel/voyage/direction, vesselETA; schedule `POST …/search.php` `{selectedOrigin:<originCode e.g. SHA>, selectedDestination:'LAX', selectedStartDate:MMDDYYYY, selectedEndDate}` → rows with `arrive` "Wednesday 11/04/2026 08:00" and `vvd` "DKI102E". Start date = load-to-vessel day − 2, end + 40, matched by vvd; not found → Matson's vesselETA day. Column B (owner's rules, my reading): no active hold → `ETA mm/dd HH:MM` (schedule arrival, or the discharge time once discharged); active hold (CONTAINER ON HOLD not followed by HOLD RELEASED with the same reason) → `HOLD mm/dd HH:MM` then every later event (`LOAD`, `Discharge`, `OUTGATE`, `INGATE`, `AVAILABLE` + time) and the ETA while not discharged. The feature replaces only its own "<word> mm/dd[ HH:MM]" tokens in B (a manual "ETA 11/04" too); other B text stays. A ✔ when the latest non-hold event is AVAILABLE and no hold is active; Matson needs no appointment, no rows are moved. Writes go through TH_Apply (moves empty) and are read back; 查柜 and Matson never run at the same time (`busy`). Host permission `https://www.matson.com/*` added. Checked against matson.com on 11/5 (MATS8051982000, MATS8112198000); not yet run end to end in the owner's Chrome.

**v0.9.17.** Owner, 11/5: sending sometimes stopped with 写信页已有正文, probably Gmail's "Help me write" prompt in the new compose body. `gmailPage` prepare no longer stops: it deletes everything in the body before the signature (and its `gmail_signature_prefix`), then inserts. The signature is still checked unchanged. Also, an edited mail (`payload.edited`) may have no container table: the adapter then checks only that the body text matches. Browser tests in `tests/browser.js` cover both.

**v0.9.18, Matson: one status in B (owner, 11/6).** Column B gets a single word: the candidate with the latest time (ETA from the schedule / discharge / Matson's ETA day, and while on hold HOLD and each later event), e.g. `ETA 11/08 12:30`. Old hand-written Matson statuses are replaced too: `VSL ETA: mm/dd` and `HOLD RELEASED` (`LEGACY` in matson-rules.ts; owner said 换). The MBL (column C) is shown next to the container in the change table, the status table (open by default) and skipped lines.

**v1.0.0 (owner, 11/6).** Version raised to 1.0.0, no code change. Version rule from now on: a small change raises the last number, a larger feature the middle one; the last two stop at 9 and carry over (1.0.9 → 1.1.0, 1.9.9 → 2.0.0); only the first may go past 9. Every version bump is also packed (owner, 11/6): build, then zip the contents of `dist\extension` (manifest.json at the zip root) as `dist\trucker-helper-v<version>.zip`; zips are not committed.

**v1.1.0, OOCL Demurrage LFD (owner, 11/6).** OOCL's Demurrage type has a new channel `oocl-rtr` (OOCL ids only: `carrier-13fb1222`, `oocl`): nothing is sent, the plugin reads the LFD itself. A saved OOCL Demurrage email with no To moves to it on read (`normalizeProfile`); Detention is untouched. Files: `src/core/oocl-rules.ts` (rules, tests/oocl-rules.test.js), `src/injected/oocl.ts`, `src/background/oocl.ts` (flow, state `ooclRun`, notification `lfd-oocl` opens the query page), `src/app/oocl.ts`, strings in `src/core/i18n-oocl.ts`. Site: OOCL Real Time Release `https://rtr.home.oocl.com/` (same app as COSCO's rtr.lines.coscoshipping.com), sign-in by Keycloak at `exiamfw.home.oocl.com` (form `#username` `#password`, cookie checkbox `#agree`, `#kc-login`; no captcha). Signed in, `GET /api/check` is 200; search `GET /api/todo/search/<MBL or container>` → `{cntrData:[{cntrNum,checkDigit,cntrStatus,relStatus,lfdUtc:'YYYYMMDDHHmmss.SSS' UTC,pickupTz,blNum,…}],messages}`; the page shows the LFD only for On Train / Discharged / At Location / Out for Delivery / Empty Returned, in pickupTz, and a time before 06:00 counts as the day before (`rtrDate`). Sign-out: `/api/frm/sso/logout` → `{data:<url>}`. Account: chrome.storage.local `ooclAccount` {username,password,checkedAt}, never in settings or the export, password never returned to the popup; config page OOCL Demurrage shows 账号 / 密码 / 「确定并检查连通性」 (signs an older session out, signs in, checks /api/check). Query page: the OOCL Demurrage group has 「查询并更新」 and 「仅查询（预览）」; with no account it jumps to that config field and starts the lookup by itself once the check passes (`pendingOocl`). Run: OOCL by MBL (bare digits get OOLU; a container missing from its bill is searched by its number) → Draydog (`openDraydog`, shared with 查柜, now exported from chagui.ts; new page actions `notes` and `addNote` = `GET/POST /containers/{n}/notes/`) → 提柜 → plan: note "SSL LFD mm/dd" unless that exact note exists, LFD = earlier of OOCL and Draydog (terminal or line LFD), written to K of the container's only business row; preview writes nothing, 「按这次结果更新」 writes the preview within 30 min. 查柜 got step `oocl` after `status`: Appointed / Bookable OOCL containers (Draydog line OOL…, or MBL OOLU…) whose notes (all of them, not only the newest the card shows) have no SSL LFD are looked up on OOCL; the date becomes the note date so the existing earliest-LFD rule takes it; the notes go with the write (also from 按预览写入). No account or an OOCL failure never stops 查柜: it says so and uses Draydog's LFD. 查柜, Matson and OOCL never run at once (shared TH_Apply). Host permissions added for the two OOCL hosts. Checked: OOCL's sign-in page and site code (11/6); not yet run with the owner's real account.

**v1.1.1, Matson moves rows (owner, 11/6).** A Matson container whose column B now reads `ETA mm/dd HH:MM` (an exact time: schedule arrival or discharge time; Matson's ETA day alone does not count) and whose row is below 未放行 moves under 按码头排 (inside 未排程), after the last MATSON row there, using 查柜's `placeMoves` and TH_Apply's move (a row with a note row under it is left for a person). The change table shows old row ↓ new row like 查柜.

**v1.1.2 (owner's screenshot, 11/6).** The OOCL query compares with the LFD the Draydog card shows (e.g. LFD 10/31, Source LBCT) also when the card says CHECK LINE FOR LFD; before, that date was dropped and the Draydog LFD column was empty. 查柜 keeps its own rule (terminal date ignored under Check Line).

**v1.1.3, Matson B keeps one status (owner, 11/6).** MATU4665360 row 168 got `Custom_H,ETA 11/04 21:15` and ✔: the ✔ was right (owner: 该打), but B must hold only the latest status. `matsonCell` now also removes 查柜's Draydog hold words (`managedPattern` of the owner's hold keywords: Custom_H, Line_H, Closed_Area …; CEX stays) on Matson rows; Matson's own events decide holds. Note a later Draydog 查柜 run may add its words back if it lists the container as Appointed/Bookable with a hold.

**v1.1.4, Matson B = latest event (owner, 11/6).** The one status in B is the latest of ALL Matson events and the ETA, e.g. MATU4665360 `Available 11/04 23:46` (AVAILABLE is written `Available`); the ETA wins a tie, so a discharge reads `ETA`. A future ETA still wins over past events. Row moves now depend on an exact vessel arrival (schedule arrival or discharged), not on B reading `ETA`.

**v1.1.5 (owner, 11/6).** 查柜 too: the LFD Draydog's card shows (the terminal's) always counts, also under CHECK LINE FOR LFD (owner: 本来就应该是这样). K = earliest of that date, the line's date and a note's SSL LFD. `observe` no longer drops `lfd` when `lineCheck`; the Appointed / Bookable table shows it.

**v1.1.6.** 查柜 tables laid out as the owner asked (11/6): container, row, column, status, terminal, position never wrap; before / after values are narrow, wrap after commas, with a → column between them (also in the Matson change table); in Appointed / Bookable, holds go one per line, the terminal and SSL LFD on two lines (no "/"), and the appointment date above its time.

**v1.1.9 (owner, 11/6).** The OOCL Demurrage LFD run card lives on the 进行中 page (TasksPage.vue), not the query page; once a lookup starts its containers leave the query input like sent ones, and a running lookup adds 1 to the 进行中 tab count. 「仅查询（预览）」 is now 「仅查询」. Result table columns: 柜号 · 状态 · SSL · Draydog (date, terminal below) · LFD · 提柜表更新; MBL and Draydog note columns removed; short columns never wrap, the status wraps narrow.

**v1.2.1 (owner, 11/6).** OOCL result table gets a 码头 column right after 柜号; the Draydog column shows only its date. 进行中 task titles show each container's MBL right after it in small light text (`taskView().items`).

**v1.3.0, 更新日志 tab (owner, 11/6).** A sixth tab, 更新日志, lists each version's changes from `src/app/changelog.ts` (see the rule above). The first entry lists Matson 柜查询 (button → 实验性功能, Matson card highlighted) and OOCL Demurrage LFD 查询 (buttons → config page OOCL Demurrage with the account field highlighted, the query page, and 查柜 in 实验性功能). Strings in zh/en/es in `src/core/i18n-changelog.ts`.

## Known limitations

- Gmail, COSCO, ONE and KDocs are driven through their page structure, so a site redesign can stop any flow. Failures stop with a message rather than guess.
- Auto CC adds the Cc when the compose window opens. Changing From to an unlisted sender later does not remove it, so accounts with several aliases need care.
- Reopening a saved draft can add back a Cc removed by hand.
- If the user is typing in the instant Auto CC opens the Cc row, a stray character could land in the Cc box. Not seen in testing.
- Pasting is the only import, because of the Windows file picker problem.
- Translations were written by an agent and not reviewed by a native speaker with trucking knowledge.
- The sheet has no terminal data, so terminal mode never auto-detects.
- Carriers in the sheet with no config: MATSON, YML, HEDE, KMTC. The owner chose not to configure them for now.
- HMM has no Demurrage or Detention recipients in the supplied config, so only On-Hire works. OOCL Detention likewise; OOCL Demurrage is looked up on OOCL's site since v1.1.0.

## Not verified on real services

- Clicking Send in real Gmail with these changes.
- COSCO ticket filling and submitting since the schema change.
- ONE chat since the schema change.
- Accounts with several send-as aliases.
- The "site access restricted" message.
- Auto CC compose and reply were last run on real Gmail at v0.5.1. Later Auto CC changes touched the button and opening logic only.

## Open items

- The GitHub repository name still contains AHIA. Renaming it is done on GitHub.
- `main` was fast-forwarded to `refactor/vue3-naiveui` on 2026-11-03. Keep pushing new work to `refactor/vue3-naiveui` and fast-forward `main` when the owner asks. Loading from `dist\extension` instead of the old folder root changed the extension id.
- Stricter TypeScript for the ported modules, which still carry `@ts-nocheck`.
