// TH build: 1
// Trucker Helper 查柜：只读脚本。安装在“我的脚本”，在提柜表（ce3LmgRtHK2F）里运行。
// 读“提柜”工作表的 A–P 列（只取查柜需要的列）和分区标记行，按 TH_START / TH_CHUNK / TH_END 打印到日志。
// 不写任何单元格。日期（K、M）和时间（N）原样输出数值，由插件换算。
const BUILD = 1;
const PER_LINE = 5; // 日志面板每行只显示约 1000 个字符

function main() {
  const sheet = Application.Sheets('提柜');
  const used = sheet.UsedRange;
  const lastRow = used.Row + used.Rows.Count - 1;
  if (lastRow > 30000) throw new Error('表格范围异常，停止读取。');
  const v = sheet.Range(sheet.Cells(1, 1), sheet.Cells(lastRow, 16)).Value2;
  const clean = x => (x == null ? '' : typeof x === 'number' ? x : String(x).trim());
  // [行号, A, B, C, D, E, F, G, H, K, M, N, P]；空行不输出
  const rows = [];
  for (let r = 0; r < v.length; r++) {
    const x = v[r];
    const cells = [x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[10], x[12], x[13], x[15]].map(clean);
    if (cells.every(c => c === '')) continue;
    rows.push([r + 1].concat(cells));
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const chunks = Math.ceil(rows.length / PER_LINE);
  console.log('TH_START:' + JSON.stringify({ id, build: BUILD, sheet: '提柜', count: rows.length, chunks, lastRow }));
  for (let i = 0; i < chunks; i++) {
    console.log('TH_CHUNK:' + JSON.stringify({ id, index: i, rows: rows.slice(i * PER_LINE, (i + 1) * PER_LINE) }));
  }
  console.log('TH_END:' + id);
}
main();
