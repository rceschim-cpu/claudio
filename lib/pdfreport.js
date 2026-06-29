// lib/pdfreport.js
// Gera um PDF REAL (via pdfkit) a partir do relatório do analyzer.

const fs = require("fs");
const PDFDocument = require("pdfkit");

const INK = "#111";
const MUTE = "#666";
const RED = "#b00020";
const GREEN = "#0a7d33";

function buildPdf(report, outPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);

    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // ---- capa / resumo ----
    doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text("Relatório de Análise de Pasta");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9).fillColor(MUTE).text(report.root);
    doc.text("Gerado em " + new Date(report.scannedAt).toLocaleString("pt-BR") + `  ·  varredura em ${(report.elapsedMs / 1000).toFixed(1)}s`);
    doc.moveDown(0.8);

    const resumo = [
      ["Arquivos analisados", report.totalFiles.toLocaleString("pt-BR")],
      ["Tamanho total", report.totalSizeHuman],
      ["Grupos de arquivos duplicados", String(report.duplicateGroups.length)],
      ["Pastas duplicadas", String(report.duplicateFolders.length)],
      ["Espaço recuperável (apagando duplicatas)", report.recoverableHuman],
    ];
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Resumo");
    doc.moveDown(0.3);
    for (const [k, v] of resumo) {
      doc.font("Helvetica").fontSize(10).fillColor(MUTE).text(k + ": ", { continued: true });
      doc.font("Helvetica-Bold").fillColor(INK).text(v);
    }
    if (report.limitedByMaxFiles || report.unverifiedCount || report.hashBudgetExceeded) {
      doc.moveDown(0.4).font("Helvetica-Oblique").fontSize(8).fillColor(RED);
      if (report.limitedByMaxFiles) doc.text("⚠ Varredura atingiu o limite de arquivos — resultado parcial.");
      if (report.unverifiedCount) doc.text(`⚠ ${report.unverifiedCount} arquivo(s) com tamanho coincidente não foram verificados por hash (teto/orçamento) — possíveis duplicados não confirmados.`);
    }

    // ---- pastas duplicadas (prioridade: o que o usuário pediu) ----
    section(doc, "Pastas duplicadas — recomendação de exclusão");
    if (!report.duplicateFolders.length) {
      muted(doc, "Nenhuma pasta inteira duplicada detectada (entre as pastas verificadas por hash).");
    } else {
      for (const f of report.duplicateFolders.slice(0, 40)) {
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GREEN).text("MANTER: ", { continued: true });
        doc.font("Helvetica").fillColor(INK).text("/" + (f.keep || "(raiz)") + `  (${f.fileCount} arquivos · ~${report.fmtBytes(f.sizeEach)})`);
        for (const r of f.remove) {
          doc.font("Helvetica-Bold").fontSize(9.5).fillColor(RED).text("EXCLUIR: ", { continued: true });
          doc.font("Helvetica").fillColor(INK).text("/" + r, { width: W });
        }
        doc.moveDown(0.5);
      }
    }

    // ---- arquivos duplicados ----
    section(doc, "Arquivos duplicados (por conteúdo)");
    if (!report.duplicateGroups.length) {
      muted(doc, "Nenhum arquivo duplicado confirmado por hash.");
    } else {
      for (const g of report.duplicateGroups.slice(0, 80)) {
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GREEN).text("MANTER: ", { continued: true });
        doc.font("Helvetica").fillColor(INK).text("/" + g.keep + `  (${report.fmtBytes(g.size)} · ${g.count} cópias)`);
        for (const r of g.remove) {
          doc.font("Helvetica-Bold").fontSize(9.5).fillColor(RED).text("EXCLUIR: ", { continued: true });
          doc.font("Helvetica").fillColor(INK).text("/" + r, { width: W });
        }
        doc.moveDown(0.4);
      }
    }

    // ---- ranking por tamanho ----
    section(doc, "Maiores arquivos (do maior para o menor)");
    report.largest.forEach((f, i) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(`${i + 1}. ${f.sizeHuman}`, { continued: true });
      doc.font("Helvetica").fillColor(MUTE).text(`  [${f.category}${f.nature ? " · " + f.nature : ""}]  `, { continued: true });
      doc.fillColor(INK).text("/" + f.rel, { width: W });
    });

    // ---- categorias ----
    section(doc, "Distribuição por tipo");
    for (const c of report.byCategory) {
      doc.font("Helvetica").fontSize(9.5).fillColor(INK)
        .text(`${c.category}: `, { continued: true })
        .fillColor(MUTE).text(`${c.count} arquivo(s) · ${c.sizeHuman}`);
    }

    doc.end();
  });
}

function section(doc, title) {
  doc.moveDown(1);
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(title);
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor("#ccc").stroke();
  doc.moveDown(0.5);
}
function muted(doc, t) {
  doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(MUTE).text(t);
}

module.exports = { buildPdf };
