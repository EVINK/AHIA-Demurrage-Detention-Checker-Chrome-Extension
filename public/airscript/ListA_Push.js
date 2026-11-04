// ListA_Push_v2 — 放在提柜表（ce3LmgRtHK2F）的文档共享脚本里，由自动化流程每 10 分钟运行。
// 读：提柜表“提柜”中 B列为“取消DO”那一行之前的所有柜号，只取 A列留空的柜号，去重，按 P列码头分组（空 → Other）。
// 写：模板表（cl7RhcdagjJs）的 Available V2，第一行码头名，下面逐列柜号；只写纯数值，不留公式。
// 前提：编辑器“服务”菜单里添加“云文档 API”（KSDrive）；运行者对模板表有编辑权限。
const TARGET_URL = 'https://www.kdocs.cn/l/cl7RhcdagjJs';
const TARGET_SHEET = 'Available V2';
// 列顺序固定（对应表里手动设置的格式）；不在列表里的码头并入 Other
const TERMINALS = ['APM', 'ETS', 'FMS', 'ITS', 'LBCT', 'MATSON', 'PCT', 'PIER A', 'TRAPAC', 'TTI', 'WBCT', 'YTI', 'Other'];
const LOG_HEADER = '更新于';
const LOG_LIMIT = 100;

function readListA() {
  const sheet = Application.Sheets('提柜');
  const used = sheet.UsedRange;
  const lastRow = used.Row + used.Rows.Count - 1;
  if (lastRow > 30000) throw new Error('表格范围异常，停止读取。');
  const clean = v => String(v == null ? '' : v).trim();
  const col = c => sheet.Range(c + '1:' + c + lastRow).Value2.map(r => clean(r[0]));
  const A = col('A'), B = col('B'), D = col('D'), P = col('P');

  const rowsWhere = (arr, test) => arr.reduce((acc, v, i) => (test(v) ? acc.concat(i + 1) : acc), []);
  const ends = rowsWhere(B, v => /^取消\s*D\s*\/?\s*O$/i.test(v));
  if (ends.length !== 1) throw new Error('取消DO 标记行不唯一或缺失：' + ends.join(','));
  const end = ends[0];

  // 只有 A列留空的柜子才写入（打勾、打叉或任何其他内容都排除）；
  // 同一柜号可能出现在多行：只要任何一行 A列不为空，整个柜号都排除
  const excluded = {};
  for (let r = 1; r < end; r++) {
    if (A[r - 1] !== '') excluded[D[r - 1].toUpperCase()] = true;
  }

  const known = TERMINALS.map(t => t.toUpperCase());
  const seen = {};
  const byTerminal = {};
  let count = 0;
  for (let r = 1; r < end; r++) {
    const container = D[r - 1].toUpperCase();
    if (!/^[A-Z]{4}\d{7}$/.test(container) || seen[container] || excluded[container]) continue;
    seen[container] = true;
    const i = known.indexOf(P[r - 1].toUpperCase());
    const terminal = i >= 0 ? TERMINALS[i] : 'Other';
    (byTerminal[terminal] = byTerminal[terminal] || []).push(container);
    count++;
  }
  return { end, count, byTerminal };
}

// 不足的格子补空串，保证是矩形
function toGrid(byTerminal) {
  const listOf = t => byTerminal[t] || [];
  const height = Math.max.apply(null, TERMINALS.map(t => listOf(t).length)) + 1;
  const grid = [];
  for (let r = 0; r < height; r++) {
    grid.push(TERMINALS.map(t => (r === 0 ? t : listOf(t)[r - 1] || '')));
  }
  return grid;
}

// 更新记录：“更新于”列下最新的在最上面，最多 LOG_LIMIT 条
function readLog(sh) {
  const row = sh.Range('A1:Z1').Value2[0].map(v => String(v == null ? '' : v).trim());
  const col = row.indexOf(LOG_HEADER) + 1;
  if (col === 0) return [];
  return sh.Range(sh.Cells(2, col), sh.Cells(LOG_LIMIT + 1, col)).Value2
    .map(r => String(r[0] == null ? '' : r[0]).trim())
    .filter(Boolean);
}

function getOrAddSheet(app, name) {
  for (let i = 1; i <= app.Sheets.Count; i++) {
    if (app.Sheets.Item(i).Name === name) return app.Sheets.Item(i);
  }
  const sh = app.Sheets.Add(null, app.Sheets.Item(app.Sheets.Count));
  sh.Name = name;
  return sh;
}

function writeGrid(sh, grid, topRow, leftCol) {
  sh.Range(sh.Cells(topRow, leftCol), sh.Cells(topRow + grid.length - 1, leftCol + grid[0].length - 1)).Value2 = grid;
}

function main() {
  const listA = readListA();
  const grid = toGrid(listA.byTerminal);
  const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour12: false }) + ' | 提柜 行 1–' + (listA.end - 1) + ' | ' + listA.count + ' 柜';

  const file = KSDrive.openFile(TARGET_URL);
  try {
    const sh = getOrAddSheet(file.Application, TARGET_SHEET);
    const log = [stamp].concat(readLog(sh)).slice(0, LOG_LIMIT);
    // 只清内容，不清格式（表头颜色、列宽等保持不变）
    sh.UsedRange.ClearContents();
    writeGrid(sh, grid, 1, 1);
    // 更新记录写在码头列右侧隔一列
    writeGrid(sh, [[LOG_HEADER]].concat(log.map(s => [s])), 1, grid[0].length + 2);
  } finally {
    file.close(); // 不关闭的话下次 openFile 会失败
  }
  console.log('List A 已写入：' + stamp);
  return { count: listA.count, terminals: grid[0], stamp };
}
return main();
