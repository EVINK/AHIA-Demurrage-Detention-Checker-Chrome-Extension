// TH build: 1
// TH_Apply：Trucker Helper 查柜写表脚本。插件每次运行前把本轮数据填进 PAYLOAD 再执行，安装在“我的脚本”，在提柜表里运行。
// 规则：
// - 按 D 列柜号重新定位行，且 C 列 MBL 必须和读取时一致；柜号不唯一就跳过。
// - 每个格子写之前先核对它仍是读取时的值，被人改过就跳过，不回改。
// - 只写目标行自己的格子；L 列 PIN 公式不碰。
// - 整行移动用“剪切 → 插入剪切的单元格”，移到“按码头排”下面同码头的最后一行之后，没有同码头就放在分区末尾。
//   每次移动前重新定位，移动后核对目标位置确实是这个柜号。
const PAYLOAD = null;

function main() {
  if (!PAYLOAD || !PAYLOAD.id) throw new Error('TH_Apply 没有收到本轮数据。');
  const sheet = Application.Sheets('提柜');
  const clean = x => (x == null ? '' : typeof x === 'number' ? x : String(x).trim());
  const id = c => String(c == null ? '' : c).toUpperCase().replace(/\s/g, '');
  const read = () => {
    const used = sheet.UsedRange;
    const lastRow = used.Row + used.Rows.Count - 1;
    return sheet.Range(sheet.Cells(1, 1), sheet.Cells(lastRow, 16)).Value2.map(r => r.map(clean));
  };
  const same = (a, b) => (typeof a === 'number' || typeof b === 'number') ? Math.abs(Number(a || 0) - Number(b || 0)) < 1e-6 && String(a) !== '' === (String(b) !== '') : String(a) === String(b);
  const rowsOf = (v, container) => v.reduce((acc, r, i) => (id(r[3]) === container ? acc.concat(i + 1) : acc), []);
  const results = [];

  // 1. Cells.
  let v = read();
  for (const change of PAYLOAD.changes) {
    const result = { container: change.container, applied: [], skipped: [] };
    results.push(result);
    const rows = rowsOf(v, change.container);
    if (rows.length !== 1) { result.skipped.push({ col: '*', reason: rows.length ? '柜号出现多行' : '找不到柜号' }); continue; }
    const r = rows[0];
    if (String(v[r - 1][2]) !== String(change.mbl)) { result.skipped.push({ col: '*', reason: 'MBL 和读取时不一致' }); continue; }
    result.row = r;
    for (const cell of change.cells) {
      const now = v[r - 1][cell.column - 1];
      if (!same(now, cell.before)) { result.skipped.push({ col: cell.col, reason: '读取后被改过', now }); continue; }
      const target = sheet.Cells(r, cell.column);
      if (cell.after === '') target.ClearContents(); else target.Value2 = cell.after;
      result.applied.push(cell.col);
    }
  }

  // 2. Moves.
  const markerRow = (rows, re) => rows.reduce((acc, r, i) => (!/^[A-Z]{4}\d{7}$/.test(id(r[3])) && re.test([r[0], r[1], r[2], r[3]].join(' ')) ? acc.concat(i + 1) : acc), []);
  for (const move of PAYLOAD.moves) {
    const result = { container: move.container, move: null };
    results.push(result);
    v = read();
    const rows = rowsOf(v, move.container);
    const unreleased = markerRow(v, /未放行/), byTerminal = markerRow(v, /按码头排/);
    if (rows.length !== 1 || unreleased.length !== 1 || byTerminal.length !== 1) { result.move = { skipped: '柜号或分区标记不唯一' }; continue; }
    const from = rows[0];
    if (String(v[from - 1][2]) !== String(move.mbl)) { result.move = { skipped: 'MBL 和读取时不一致' }; continue; }
    if (from <= unreleased[0]) { result.move = { skipped: '已不在未放行下面' }; continue; }
    let dest = unreleased[0];
    for (let r = byTerminal[0] + 1; r < unreleased[0]; r++) {
      if (/^[A-Z]{4}\d{7}$/.test(id(v[r - 1][3])) && String(v[r - 1][15]).toUpperCase() === String(move.terminal).toUpperCase()) dest = r + 1;
    }
    sheet.Range(from + ':' + from).Cut();
    sheet.Range(dest + ':' + dest).Insert();
    const after = read();
    const landed = rowsOf(after, move.container);
    result.move = landed.length === 1 && landed[0] === dest ? { from, to: dest } : { error: '移动后核对失败', rows: landed };
  }

  const lines = results.map(r => JSON.stringify(r));
  console.log('TH_START:' + JSON.stringify({ id: PAYLOAD.id, build: 1, count: lines.length, chunks: lines.length }));
  lines.forEach((l, i) => console.log('TH_CHUNK:' + JSON.stringify({ id: PAYLOAD.id, index: i, rows: [l] })));
  console.log('TH_END:' + PAYLOAD.id);
}
main();
