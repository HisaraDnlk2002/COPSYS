// Turns a {columns, rows} shape into a downloadable CSV string or PDF
// buffer. Kept deliberately generic — every report type in
// reportsController.js funnels through the same two builders so a new
// report type only has to produce {columns, rows}, not its own file logic.

const PDFDocument = require("pdfkit");

function escapeCsvValue(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// columns: [{ key, label }]  rows: [{ [key]: value }]
function buildCsv(columns, rows) {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(","));
  return [header, ...lines].join("\n");
}

// title/subtitle: header text. meta: [[label, value], ...] printed under
// the title (date range, generated-by, station). columns/rows: same
// shape as buildCsv. Resolves to a Buffer once the document finishes
// streaming internally.
function buildPdf({ title, subtitle, meta = [], columns, rows }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(18).fillColor("#111").text(title);
      if (subtitle) {
        doc.moveDown(0.2).fontSize(10).fillColor("#666").text(subtitle);
      }
      doc.moveDown(0.6);

      if (meta.length) {
        doc.fontSize(10).fillColor("#333");
        meta.forEach(([label, value]) => doc.text(`${label}: ${value}`));
        doc.moveDown(0.8);
      }

      const left = doc.page.margins.left;
      const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidth = usableWidth / columns.length;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      function drawHeaderRow(y) {
        doc.fontSize(9).fillColor("#fff");
        doc.rect(left, y, usableWidth, 20).fill("#2b4c7e");
        doc.fillColor("#fff");
        columns.forEach((c, i) => {
          doc.text(c.label, left + i * colWidth + 4, y + 6, { width: colWidth - 8 });
        });
        return y + 20;
      }

      let y = drawHeaderRow(doc.y);

      doc.fontSize(9).fillColor("#111");
      rows.forEach((row, idx) => {
        if (y + 18 > bottomLimit) {
          doc.addPage();
          y = drawHeaderRow(doc.page.margins.top);
        }
        if (idx % 2 === 1) {
          doc.rect(left, y, usableWidth, 18).fill("#f4f6f9");
        }
        doc.fillColor("#111");
        columns.forEach((c, i) => {
          const val = row[c.key];
          doc.text(val === null || val === undefined ? "" : String(val), left + i * colWidth + 4, y + 5, {
            width: colWidth - 8,
          });
        });
        y += 18;
      });

      if (rows.length === 0) {
        doc.moveDown(1).fontSize(10).fillColor("#888").text("No records found for this date range.", left, y + 10);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildCsv, buildPdf };