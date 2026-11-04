// TH build: 2
// Trucker Helper 查柜：只读脚本。安装在“我的脚本”，在模板表（cl7RhcdagjJs）里运行。
// 读：Available V2 工作表。第一行是码头名，下面逐列是柜号；“更新于”列的第一条是最近一次推送记录。
// 不写任何单元格。结果按 TH_START / TH_CHUNK / TH_END 分段打印到日志，由插件读取。
const SHEET = 'Available V2';
const BUILD = 2;
// 日志面板只显示每行前约 1000 个字符：每段 25 个柜号（约 650 字符），插件从界面读取时也完整
const CHUNK = 25;

function main() {
  let sheet = null;
  for (let i = 1; i <= Application.Sheets.Count; i++) {
    if (Application.Sheets.Item(i).Name === SHEET) sheet = Application.Sheets.Item(i);
  }
  if (!sheet) throw new Error('找不到工作表：' + SHEET);
  const used = sheet.UsedRange;
  const lastRow = used.Row + used.Rows.Count - 1;
  const lastCol = used.Column + used.Columns.Count - 1;
  if (lastRow > 5000 || lastCol > 60) throw new Error('Available V2 范围异常，停止读取。');
  const clean = v => String(v == null ? '' : v).trim();
  const grid = sheet.Range(sheet.Cells(1, 1), sheet.Cells(lastRow, lastCol)).Value2.map(r => r.map(clean));
  const header = grid[0];
  const logCol = header.indexOf('更新于');
  const stamp = logCol >= 0 && grid[1] ? grid[1][logCol] : '';
  const rows = [];
  const seen = {};
  for (let c = 0; c < header.length; c++) {
    if (!header[c] || c === logCol) continue;
    // 码头列在“更新于”左边；更新记录列之后的内容不是柜号
    if (logCol >= 0 && c > logCol) continue;
    for (let r = 1; r < grid.length; r++) {
      const container = grid[r][c].toUpperCase();
      if (!/^[A-Z]{4}\d{7}$/.test(container) || seen[container]) continue;
      seen[container] = true;
      rows.push([container, header[c]]);
    }
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const chunks = Math.ceil(rows.length / CHUNK);
  console.log('TH_START:' + JSON.stringify({ id, build: BUILD, sheet: SHEET, count: rows.length, chunks, stamp, terminals: header.filter((h, c) => h && c !== logCol && !(logCol >= 0 && c > logCol)) }));
  for (let i = 0; i < chunks; i++) {
    console.log('TH_CHUNK:' + JSON.stringify({ id, index: i, rows: rows.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  console.log('TH_END:' + id);
}
main();
