// lib/office.js
// Geração de arquivos Office REAIS:
//   - CSV → .xlsx (exceljs)
//   - Markdown → .docx (docx)
// O cowork emite <xlsx name="...">CSV</xlsx> ou <docx name="...">markdown</docx>;
// o servidor converte para o arquivo binário e oferece download.

const ExcelJS = require("exceljs");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = require("docx");
const PptxGenJS = require("pptxgenjs");

// --- CSV parser (lida com aspas e vírgulas dentro de campos) ---
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = String(text).replace(/\r\n/g, "\n").trim();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === ";" && !s.includes(",")) { row.push(field); field = ""; } // aceita ; como separador
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

async function csvToXlsx(csvText, outPath, { sheetName = "Dados" } = {}) {
  const rows = parseCsv(csvText);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 30) || "Dados");
  rows.forEach((r, i) => {
    const row = ws.addRow(r.map((c) => {
      const n = Number(String(c).replace(/\./g, "").replace(",", "."));
      return c !== "" && !isNaN(n) && /^[\d.,\-\s]+$/.test(c) ? n : c;
    }));
    if (i === 0) row.font = { bold: true };
  });
  // largura automática simples
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, (cell) => { max = Math.max(max, String(cell.value ?? "").length + 2); });
    col.width = Math.min(60, max);
  });
  if (rows.length) ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// --- Markdown → docx (subset: headings, bold, listas, tabelas) ---
function inlineRuns(text) {
  const runs = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun(text.slice(last, m.index)));
    runs.push(new TextRun({ text: m[1], bold: true }));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)));
  return runs.length ? runs : [new TextRun(text)];
}

function mdTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((cells, ri) =>
      new TableRow({
        children: cells.map((c) => new TableCell({
          children: [new Paragraph({ children: ri === 0 ? [new TextRun({ text: c.trim(), bold: true })] : inlineRuns(c.trim()) })],
        })),
      })
    ),
  });
}

async function markdownToDocx(md, outPath, { title } = {}) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const children = [];
  if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][h[1].length - 1];
      children.push(new Paragraph({ text: h[2], heading: lvl }));
      i++; continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      children.push(new Paragraph({ children: inlineRuns(line.replace(/^\s*[-*]\s+/, "")), bullet: { level: 0 } }));
      i++; continue;
    }
    // tabela: linhas consecutivas começando com |
    if (/^\s*\|.*\|/.test(line)) {
      const tbl = [];
      while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|");
        if (!/^\s*-+\s*$/.test(cells[0])) tbl.push(cells); // pula separador ---
        i++;
      }
      if (tbl.length) children.push(mdTable(tbl));
      children.push(new Paragraph(""));
      continue;
    }
    if (line.trim() === "") { children.push(new Paragraph("")); i++; continue; }
    children.push(new Paragraph({ children: inlineRuns(line) }));
    i++;
  }

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  require("fs").writeFileSync(outPath, buf);
  return outPath;
}

// --- Markdown → .pptx ---
// Slides separados por linha "---". Em cada slide: "# Título" e bullets "- ".
async function markdownToPptx(md, outPath, { title } = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const slidesRaw = String(md).replace(/\r\n/g, "\n").split(/\n-{3,}\n/);

  // slide de capa, se houver título
  if (title) {
    const s = pptx.addSlide();
    s.background = { color: "0B110B" };
    s.addText(title, { x: 0.5, y: 2.2, w: "90%", h: 1.5, fontSize: 40, bold: true, color: "36FF6A", align: "center" });
  }

  for (const raw of slidesRaw) {
    const lines = raw.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    let y = 0.4;
    const head = lines[0].match(/^#{1,3}\s+(.*)/);
    let bulletStart = 0;
    if (head) {
      slide.addText(head[1], { x: 0.5, y, w: "92%", h: 0.9, fontSize: 28, bold: true, color: "1B5E20" });
      y += 1.1; bulletStart = 1;
    }
    const bullets = lines.slice(bulletStart).map((l) => l.replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, ""));
    if (bullets.length) {
      slide.addText(bullets.map((t) => ({ text: t, options: { bullet: true, fontSize: 18, color: "222222", paraSpaceAfter: 8 } })),
        { x: 0.7, y, w: "88%", h: 5 });
    }
  }
  await pptx.writeFile({ fileName: outPath });
  return outPath;
}

module.exports = { csvToXlsx, markdownToDocx, markdownToPptx, parseCsv };
