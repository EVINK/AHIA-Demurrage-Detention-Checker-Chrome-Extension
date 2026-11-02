# Trucker Helper: handoff for agents

Formerly "LFD Inquiry". Written at v0.6.2, updated for the Vue rewrite at v0.7.0. `agent.md` holds the older detailed history in Chinese; where the two differ, this file wins.

## Purpose

A Chrome extension (Manifest V3) for a trucking operations team. The user pastes a container number; the extension finds its MBL and carrier in a KDocs (金山文档) sheet, then prepares an inquiry to that carrier. The extension does not obtain the LFD (last free day) itself: it sends the question and a human reads the reply.

Inquiries go out by Gmail, by the COSCO ticket website, or by ONE's live chat. An experimental Auto CC feature adds Cc addresses to ordinary Gmail compose and reply windows.

## Rules that must not be broken

- Never send a real email, submit a real ticket or contact a real agent in testing without the owner's explicit permission. Use draft mode. Note that ONE's "draft" reaches a real human agent.
- Never write to the KDocs sheet. The extension only reads it.
- Never type the owner's credentials or solve a captcha. COSCO's reCAPTCHA is always solved by the user.
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
| `portal.reference` exactly `AHIA` | Empty |
| Generic On-Hire text on an old COSCO entry | COSCO's own wording |

A version 1 file does not mention terminals, mode, Auto CC or language, so those keep their current values on import.

## Channels

`type.channel` decides how an inquiry goes out, per type. `channelsFor(profileId)` limits the choice: `cosco-portal` belongs to id `cosco`, `one-chat` to id `one`, and everyone else has only `email`.

**email.** Gmail web by default. The worker opens `/mail/u/N/?view=cm&fs=1&to=&cc=&su=`, which Gmail rewrites to `?fs=1&…`, then injects `gmailPage`. Send is confirmed only by Gmail's notice and then Gmail closing the tab; anything less is recorded as `uncertain`. Foxmail and Outlook use `mailto:`; the user sends and clicks 我已发送.

**cosco-portal.** Detention goes to support.cosco-usa.com, On-Hire to coscoshippingla.freshdesk.com. The user solves the captcha in a small window and the plugin clicks Submit. COSCO has no Demurrage type: `resolveType` turns a Demurrage request into Detention. `portal.reference` is optional and is skipped when empty; the owner confirmed it is not required.

**one-chat.** Runs on one-line.com: form, menus, transfer to agent, one message per container, done when each shows Read. ONE allows one chat per browser, so tasks queue and append to a live chat. On-Hire for ONE is email.

Several containers in one message: ONE chat, On-Hire, and custom email types (`supportsManyContainers`).

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

This branch is checked out in its own worktree, `C:\Users\AMERI\Documents\workspace\demurrage-lfd-extension-vue`. Load unpacked from its `dist\extension`, after `vite build`. Never switch the branch of the original `demurrage-lfd-extension` folder: the owner's Chrome loads v0.6.x from that folder's root, and this branch has no root `manifest.json`.

1. Build.
2. `chrome://extensions` → Trucker Helper → refresh.
3. Refresh open Gmail tabs, or content scripts stay old.

Until step 2, the page can load new files while the worker runs old code, which shows up as errors such as `配置包含不支持的字段：mode`. Bump the version on any fix so the footer shows which code is live.

An unpacked extension's id comes from its folder, so the Vue build has a different id from v0.6.x and its own `chrome.storage`. Settings move by 导出 JSON in the old plugin and pasting into 导入 in the new one. History and duplicate locks do not move. Remove the old plugin afterwards, or Auto CC runs twice.

## Changelog

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

## Known limitations

- Gmail, COSCO, ONE and KDocs are driven through their page structure, so a site redesign can stop any flow. Failures stop with a message rather than guess.
- Auto CC adds the Cc when the compose window opens. Changing From to an unlisted sender later does not remove it, so accounts with several aliases need care.
- Reopening a saved draft can add back a Cc removed by hand.
- If the user is typing in the instant Auto CC opens the Cc row, a stray character could land in the Cc box. Not seen in testing.
- Pasting is the only import, because of the Windows file picker problem.
- Translations were written by an agent and not reviewed by a native speaker with trucking knowledge.
- The sheet has no terminal data, so terminal mode never auto-detects.
- Carriers in the sheet with no config: MATSON, YML, HEDE, KMTC. The owner chose not to configure them for now.
- OOCL and HMM have no Demurrage or Detention recipients in the supplied config, so only On-Hire works.

## Not verified on real services

- Clicking Send in real Gmail with these changes.
- COSCO ticket filling and submitting since the schema change.
- ONE chat since the schema change.
- Accounts with several send-as aliases.
- The "site access restricted" message.
- Auto CC compose and reply were last run on real Gmail at v0.5.1. Later Auto CC changes touched the button and opening logic only.

## Open items

- The branch `fix/gmail-send-confirmation` has no pull request and is not merged to `main`.
- The GitHub repository name still contains AHIA. Renaming it is done on GitHub.
- `refactor/vue3-naiveui` is pushed and not merged. Merging moves the load path to `dist/extension`, which changes the extension id.
- Stricter TypeScript for the ported modules, which still carry `@ts-nocheck`.
