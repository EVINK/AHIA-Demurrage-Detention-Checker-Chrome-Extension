// LFD_ReadOnly_v1 — only reads cells; never writes, sorts, or activates a sheet.
// Version 2. Output contains only container, MBL, source row and carrier.
// The 取消DO section is skipped until the next section header (已送仓 / 排程:), not treated as the end of the sheet.
function main() {
  const sheet = Application.Sheets('提柜');
  const used = sheet.UsedRange;
  const lastRow = used.Row + used.Rows.Count - 1;
  const lastCol = used.Column + used.Columns.Count - 1;
  if (lastRow > 30000 || lastCol > 200) throw new Error('表格范围异常，停止读取。');
  const clean = v => String(v == null ? '' : v).trim();
  const norm = v => clean(v).toLowerCase().replace(/[\s#＃_./()（）-]/g, '');
  const head = sheet.Range(sheet.Cells(1,1), sheet.Cells(Math.min(30,lastRow),lastCol)).Value2;
  let header = -1, ci = -1, mi = -1, ai = -1;
  for (let r = 0; r < head.length; r++) {
    const names = head[r].map(norm);
    const c = names.findIndex(v => ['柜号','箱号','集装箱号','container','containerno','containernumber'].includes(v));
    const m = names.findIndex(v => ['mbl','mblno','mblnumber','主单号','主提单号','海单号','提单号','提单'].includes(v));
    const a = names.findIndex(v => ['船司','船公司','船公司名称','航司','航运公司','承运人','承运商','carrier','shippingline','shippingcompany','steamshipline','ssl'].includes(v));
    if (c >= 0 && m >= 0) { header = r + 1; ci = c; mi = m; ai = a; break; }
  }
  if (header < 0) throw new Error('没有找到柜号和 MBL 表头。');
  const records = []; let cancelled = false, cancelledSections = 0, skippedRows = 0;
  for (let start = header + 1; start <= lastRow; start += 500) {
    const values = sheet.Range(sheet.Cells(start,1),sheet.Cells(Math.min(start + 499,lastRow),lastCol)).Value2;
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (row.some(v => /^取消\s*D\s*\/?\s*O$/i.test(clean(v)))) { cancelled = true; cancelledSections++; continue; }
      if (cancelled && row.some(v => /^(已送仓|排程\s*[:：])/.test(clean(v)))) { cancelled = false; continue; }
      if (cancelled) { skippedRows++; continue; }
      const container = clean(row[ci]).toUpperCase();
      if (/^[A-Z]{4}\d{7}$/.test(container)) {
        const carrier=ai<0?'':clean(row[ai]);
        if(carrier.length>120||clean(row[mi]).length>100)throw new Error('MBL 或船公司字段过长，请检查表格。');
        records.push({container, mbl: clean(row[mi]), row: start + i, carrier});
      }
    }
  }
  const result = {version: 2, sheet: '提柜', readAt: Date.now(), records, cancelledSections, skippedRows};
  // Keep each log entry below the editor's truncation limit.
  const id = result.readAt;
  const pieces=[];let batch=[];
  for(const r of records){
    const row=[r.container,r.mbl,r.row,r.carrier];
    if(batch.length&&(batch.length>=6||JSON.stringify({id,index:pieces.length,rows:batch.concat([row])}).length>850)){pieces.push(batch);batch=[];}
    batch.push(row);
  }
  if(batch.length)pieces.push(batch);
  console.log('LFD_START:' + JSON.stringify({id, version:2, count: records.length, chunks: pieces.length, sheet: '提柜', cancelledSections, skippedRows}));
  for (let i = 0; i < pieces.length; i++) {
    console.log('LFD_CHUNK:' + JSON.stringify({id, index:i, rows:pieces[i]}));
  }
  console.log('LFD_END:' + id);
  return result;
}
main();
