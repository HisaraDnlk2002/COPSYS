// Turns a {columns, rows} shape into a downloadable CSV, PDF, or Excel
// file, written directly to the HTTP response as it's generated rather
// than fully buffered in memory first — a large report no longer has to
// exist twice over (once as row objects, once as a complete rendered
// string/buffer/workbook) before the client sees a single byte. Kept
// deliberately generic — every report type in reportsController.js
// funnels through the same three writers so a new report type only has
// to produce {columns, rows}, not its own file logic.

const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
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
// Writes the header line then one line per row directly to `res` (the
// caller sets Content-Type/Content-Disposition first, same as before —
// this only replaces how the body gets there), instead of joining every
// row into one giant string before anything is sent. Ends the response
// itself once the last row is written.
function writeCsvToResponse(res, columns, rows) {
  res.write(columns.map((c) => escapeCsvValue(c.label)).join(",") + "\n");
  for (const row of rows) {
    res.write(columns.map((c) => escapeCsvValue(row[c.key])).join(",") + "\n");
  }
  res.end();
}

// title/subtitle: header text. meta: [[label, value], ...] printed under
// the title (date range, filters applied, generated-by/on). summary: a
// flat { label: value } object (from reportsController's computeSummary)
// printed as a highlighted line below meta — the same at-a-glance numbers
// shown on the preview panel's stat cards, carried into the file itself
// rather than only ever existing on screen. columns/rows: same shape as
// writeCsvToResponse. reportRef: short human-facing id printed in the
// footer next to the signature block (e.g. "RPT-4F91A2") — purely
// cosmetic, not a persisted sequential counter. Piped straight to `res`
// (the caller sets Content-Type/Content-Disposition first) instead of
// being built into one complete in-memory Buffer before anything is sent
// — PDFKit still renders page-by-page internally either way, but the
// client now starts receiving bytes as soon as the first page is ready
// rather than waiting for the whole document. Resolves once `res` has
// finished receiving everything.
function streamPdfToResponse(res, { title, subtitle, meta = [], summary = {}, columns, rows, reportRef }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      doc.on("error", reject);
      res.on("finish", resolve);
      res.on("error", reject);
      doc.pipe(res);

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

      const summaryEntries = Object.entries(summary);
      if (summaryEntries.length) {
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#111").text("SUMMARY");
        doc.moveDown(0.2);
        const summaryY = doc.y;
        doc.rect(left, summaryY, usableWidth, 26).fill("#f4f6f9");
        const entryWidth = usableWidth / summaryEntries.length;
        summaryEntries.forEach(([label, value], i) => {
          doc
            .fontSize(8)
            .font("Helvetica")
            .fillColor("#666")
            .text(label, left + i * entryWidth + 8, summaryY + 4, { width: entryWidth - 16 });
          doc
            .fontSize(11)
            .font("Helvetica-Bold")
            .fillColor("#111")
            .text(String(value), left + i * entryWidth + 8, summaryY + 14, { width: entryWidth - 16 });
        });
        doc.y = summaryY + 26;
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

// A, B, ..., Z, AA, AB, ... — exceljs wants column letters, not indexes,
// for the merged title/meta rows below (the table itself just uses
// addRow(), which doesn't need this).
function columnLetter(oneBasedIndex) {
  let n = oneBasedIndex;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// Same letterhead/meta/summary/signature shape as streamPdfToResponse,
// laid out as plain top-to-bottom rows instead of PDFKit's absolute
// x/y positioning — exceljs's streaming WorkbookWriter (used here, same
// "don't buffer the whole file in memory" reasoning as the CSV/PDF
// writers above) commits one row at a time, so there's no going back to
// redraw an earlier row once written. useStyles:true is required for any
// per-cell font/fill formatting to actually apply in streaming mode.
function streamXlsxToResponse(res, { title, subtitle, meta = [], summary = {}, columns, rows, reportRef }) {
  return new Promise((resolve, reject) => {
    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
      res.on("finish", resolve);
      res.on("error", reject);

      const sheet = workbook.addWorksheet(String(title).slice(0, 31) || "Report");
      const numCols = Math.max(columns.length, 3);
      sheet.columns = columns.map((c) => ({ key: c.key, width: 22 }));

      function addTextRow(text, { bold = false, size = 10, color = "FF111111", align = "left" } = {}) {
        const row = sheet.addRow([text]);
        const cell = row.getCell(1);
        cell.font = { bold, size, color: { argb: color } };
        cell.alignment = { horizontal: align };
        row.commit();
      }

      addTextRow("SRI LANKA POLICE", { bold: true, size: 14, align: "center" });
      addTextRow("POLICE STATION MANAGEMENT SYSTEM", { size: 9, color: "FF666666", align: "center" });
      sheet.addRow([]).commit();
      addTextRow(String(title).toUpperCase(), { bold: true, size: 13, align: "center" });
      if (subtitle) addTextRow(subtitle, { size: 10, color: "FF666666", align: "center" });
      sheet.addRow([]).commit();

      meta.forEach(([label, value]) => {
        const row = sheet.addRow([`${label}:`, String(value)]);
        row.getCell(1).font = { bold: true, size: 9, color: { argb: "FF333333" } };
        row.getCell(2).font = { size: 9, color: { argb: "FF333333" } };
        row.commit();
      });
      sheet.addRow([]).commit();

      const summaryEntries = Object.entries(summary);
      if (summaryEntries.length) {
        addTextRow("SUMMARY", { bold: true, size: 10 });
        const labelRow = sheet.addRow(summaryEntries.map(([label]) => label));
        labelRow.eachCell((cell) => {
          cell.font = { size: 8, color: { argb: "FF666666" } };
        });
        labelRow.commit();
        const valueRow = sheet.addRow(summaryEntries.map(([, value]) => value));
        valueRow.eachCell((cell) => {
          cell.font = { bold: true, size: 11, color: { argb: "FF111111" } };
        });
        valueRow.commit();
        sheet.addRow([]).commit();
      }

      const headerRow = sheet.addRow(columns.map((c) => c.label));
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2B4C7E" } };
      });
      headerRow.commit();

      for (const row of rows) {
        const dataRow = sheet.addRow(columns.map((c) => (row[c.key] === null || row[c.key] === undefined ? "" : row[c.key])));
        dataRow.eachCell((cell) => {
          cell.font = { size: 9 };
        });
        dataRow.commit();
      }

      if (rows.length === 0) {
        addTextRow("No records found for this date range.", { size: 10, color: "FF888888" });
      }

      sheet.addRow([]).commit();
      addTextRow(`Report ID: ${reportRef || "—"}`, { size: 8, color: "FF888888" });

      sheet.addRow([]).commit();
      const sigLabels = ["Prepared By", "Checked By", "Approved By"];
      const sigLine = sheet.addRow(sigLabels.map(() => "_______________________"));
      sigLine.eachCell((cell) => {
        cell.font = { size: 9, color: { argb: "FF999999" } };
      });
      sigLine.commit();
      const sigLabelsRow = sheet.addRow(sigLabels);
      sigLabelsRow.eachCell((cell) => {
        cell.font = { size: 9, color: { argb: "FF333333" } };
      });
      sigLabelsRow.commit();

      // Column widths beyond the data columns (for the wider letterhead
      // text rows above) — exceljs only sized the ones addressed via
      // sheet.columns, so pad out to at least numCols.
      for (let i = columns.length + 1; i <= numCols; i++) {
        sheet.getColumn(i).width = 22;
      }

      sheet.commit();
      workbook.commit().catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { writeCsvToResponse, streamPdfToResponse, streamXlsxToResponse };
