// Turns a {columns, rows} shape into a downloadable CSV string or PDF
// buffer. Kept deliberately generic — every report type in
// reportsController.js funnels through the same two builders so a new
// report type only has to produce {columns, rows}, not its own file logic.

const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

// Same artwork as the client's topbar/login logo (see
// client/src/assets/Sri_Lanka_Police_logo.svg.png) — copied here so the
// server doesn't reach across into the client package at runtime.
// Missing/unreadable is handled gracefully (letterhead just skips it)
// rather than failing report generation over a missing image.
const LOGO_PATH = path.join(__dirname, "..", "assets", "police-logo.png");
const HAS_LOGO = fs.existsSync(LOGO_PATH);

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
// the title (date range, filters applied, generated-by/on). columns/rows:
// same shape as buildCsv. reportRef: short human-facing id printed in the
// footer next to the signature block (e.g. "RPT-4F91A2") — purely
// cosmetic, not a persisted sequential counter. Resolves to a Buffer once
// the document finishes streaming internally.
function buildPdf({ title, subtitle, meta = [], columns, rows, reportRef }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = doc.page.margins.left;
      const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      // --- Letterhead ---
      if (HAS_LOGO) {
        try {
          doc.image(LOGO_PATH, doc.page.width / 2 - 18, doc.y, { width: 36, height: 36 });
          doc.moveDown(2.6);
        } catch {
          // A bad/unreadable logo file should never block report generation.
        }
      }
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor("#111")
        .text("SRI LANKA POLICE", left, doc.y, { width: usableWidth, align: "center" });
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#666")
        .text("POLICE STATION MANAGEMENT SYSTEM", { width: usableWidth, align: "center" });
      doc.moveDown(0.5);
      doc
        .moveTo(left, doc.y)
        .lineTo(left + usableWidth, doc.y)
        .strokeColor("#ccc")
        .stroke();
      doc.moveDown(0.6);

      doc
        .fontSize(15)
        .font("Helvetica-Bold")
        .fillColor("#111")
        .text(String(title).toUpperCase(), { width: usableWidth, align: "center" });
      if (subtitle) {
        doc
          .moveDown(0.15)
          .fontSize(10)
          .font("Helvetica")
          .fillColor("#666")
          .text(subtitle, { width: usableWidth, align: "center" });
      }
      doc.moveDown(0.8);

      if (meta.length) {
        doc.fontSize(9).font("Helvetica").fillColor("#333");
        meta.forEach(([label, value]) => doc.text(`${label}: ${value}`));
        doc.moveDown(0.8);
      }

      const colWidth = usableWidth / columns.length;

      function drawHeaderRow(y) {
        doc.fontSize(9).font("Helvetica-Bold").fillColor("#fff");
        doc.rect(left, y, usableWidth, 20).fill("#2b4c7e");
        doc.fillColor("#fff");
        columns.forEach((c, i) => {
          doc.text(c.label, left + i * colWidth + 4, y + 6, { width: colWidth - 8 });
        });
        return y + 20;
      }

      let y = drawHeaderRow(doc.y);

      doc.fontSize(9).font("Helvetica").fillColor("#111");
      rows.forEach((row, idx) => {
        if (y + 18 > bottomLimit) {
          doc.addPage();
          y = drawHeaderRow(doc.page.margins.top);
          doc.font("Helvetica");
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
        y += 30;
      }

      // --- Signature block / footer ---
      const footerHeight = 100;
      if (y + footerHeight > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
      } else {
        y += 34;
      }
      const sigColWidth = usableWidth / 3;
      doc.fontSize(9).font("Helvetica").fillColor("#333");
      ["Prepared By", "Checked By", "Approved By"].forEach((label, i) => {
        const x = left + i * sigColWidth;
        doc
          .moveTo(x, y)
          .lineTo(x + sigColWidth - 24, y)
          .strokeColor("#999")
          .stroke();
        doc.text(label, x, y + 4, { width: sigColWidth - 24 });
      });

      doc
        .fontSize(8)
        .fillColor("#888")
        .text(`Report ID: ${reportRef || "—"}`, left, y + 40);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildCsv, buildPdf };
