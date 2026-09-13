// Builds the formal "Complaint Acknowledgement / Receipt" PDF an officer
// hands (or emails) to a complainant right after registering their
// complaint — a single structured document, not a data table, so it gets
// its own builder rather than reusing reportFileBuilder's {columns,rows}
// shape.

const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

// Same artwork/letterhead convention as reportFileBuilder.js.
const LOGO_PATH = path.join(__dirname, "..", "assets", "police-logo.png");
const HAS_LOGO = fs.existsSync(LOGO_PATH);

// Single-station app (every model defaults stationId to "default-station")
// — there's no station directory to look this name up from, so it's
// fixed here the same way the login page's own subtitle names it.
const STATION_NAME = "KATUNAYAKE AIRPORT POLICE STATION";

// Full register names for the "Register" line — mirrors
// Complaints.jsx's own COMPLAINT_BOOK_OPTIONS (kept as a small local
// copy rather than a cross-package import, same convention already used
// for REPORT_TYPE_LABELS etc.).
const BOOK_LABELS = {
  IB: "IB — Information Book",
  CR: "CR — Crime Register",
  TR: "TR — Traffic Register",
  LPR: "LPR — Lost Property Register",
  MPR: "MPR — Missing Persons Register",
  WCD: "WCD — Women & Children's Desk",
  DVR: "DVR — Domestic Violence Register",
  GCR: "GCR — General Complaint Register",
};

// Receipt-friendly wording for the complaint's current lifecycle status —
// distinct from the Badge component's short labels used in the UI tables.
const STATUS_LABELS = {
  open: "Registered",
  investigating: "Under Investigation",
  paused: "Paused",
  closed: "Closed",
};

function formatDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatTime(d) {
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${period}`;
}

// complaint: a populated Complaint document (registeredBy populated with
// { fullName, rankAndNumber }). Resolves to a Buffer once the PDF
// finishes streaming internally, same pattern as reportFileBuilder's
// buildPdf.
function buildComplaintReceipt(complaint) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = doc.page.margins.left;
      const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // --- Letterhead ---
      if (HAS_LOGO) {
        try {
          doc.image(LOGO_PATH, doc.page.width / 2 - 18, doc.y, { width: 36, height: 36 });
          doc.moveDown(2.6);
        } catch {
          // A bad/unreadable logo file should never block receipt generation.
        }
      }
      doc.fontSize(14).font("Helvetica-Bold").fillColor("#111").text("SRI LANKA POLICE", left, doc.y, { width: usableWidth, align: "center" });
      doc.fontSize(10).font("Helvetica").fillColor("#666").text(STATION_NAME, { width: usableWidth, align: "center" });
      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(left + usableWidth, doc.y).strokeColor("#ccc").stroke();
      doc.moveDown(0.6);
      doc.fontSize(15).font("Helvetica-Bold").fillColor("#111").text("COMPLAINT ACKNOWLEDGEMENT / RECEIPT", { width: usableWidth, align: "center" });
      doc.moveDown(1);

      const createdAt = complaint.createdAt || new Date();
      const nicOrPassport = complaint.complainant?.nic
        ? { label: "NIC No.", value: complaint.complainant.nic }
        : { label: "Passport No.", value: complaint.complainant?.passportId || "—" };

      const rows = [
        ["Complaint Reference No.", complaint.refId],
        ["Register", BOOK_LABELS[complaint.complaintBook] || complaint.complaintBook],
        ["Date", formatDate(createdAt)],
        ["Time", formatTime(createdAt)],
        ["Police Station", STATION_NAME],
        ["Complainant Name", complaint.complainant?.fullName || "—"],
        [nicOrPassport.label, nicOrPassport.value],
        ["Contact No.", complaint.complainant?.contactNumber || "—"],
        ["Complaint Type", complaint.category],
        [
          "Complaint Received By",
          complaint.registeredBy
            ? `${complaint.registeredBy.fullName} (${complaint.registeredBy.rankAndNumber})`
            : "—",
        ],
        ["Status", STATUS_LABELS[complaint.status] || complaint.status],
      ];

      // --- Field grid: label column + value column, two per row ---
      const colWidth = usableWidth / 2;
      const labelWidth = 130;
      let y = doc.y;
      for (let i = 0; i < rows.length; i += 2) {
        const rowHeight = 22;
        [rows[i], rows[i + 1]].forEach((pair, col) => {
          if (!pair) return;
          const x = left + col * colWidth;
          doc.fontSize(9).font("Helvetica-Bold").fillColor("#555").text(pair[0], x, y, { width: labelWidth });
          doc.fontSize(10).font("Helvetica").fillColor("#111").text(String(pair[1]), x, y + 13, { width: colWidth - 12 });
        });
        y += rowHeight + 14;
      }
      doc.y = y + 6;

      // --- Brief description (full width, can wrap to several lines) ---
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#555").text("Brief Description", left, doc.y);
      doc.moveDown(0.2);
      doc.fontSize(10).font("Helvetica").fillColor("#111").text(complaint.description || "—", left, doc.y, { width: usableWidth });
      doc.moveDown(1.2);

      doc.moveTo(left, doc.y).lineTo(left + usableWidth, doc.y).strokeColor("#ccc").stroke();
      doc.moveDown(0.8);

      // --- Next steps note ---
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#111").text("Next Steps", left, doc.y);
      doc.moveDown(0.2);
      doc.fontSize(9).font("Helvetica").fillColor("#333").text(
        `Your complaint has been recorded at this police station. Please quote the Complaint Reference Number (${complaint.refId}) when making inquiries regarding this complaint.`,
        left,
        doc.y,
        { width: usableWidth }
      );
      doc.moveDown(2);

      // --- Signature / stamp block ---
      const bottomLimit = doc.page.height - doc.page.margins.bottom;
      if (doc.y + 90 > bottomLimit) doc.addPage();
      const sigY = doc.y + 20;
      const sigColWidth = usableWidth / 2;
      doc.fontSize(9).font("Helvetica").fillColor("#333");
      [
        ["Complainant Signature", 0],
        ["Receiving Officer Signature", 1],
      ].forEach(([label, col]) => {
        const x = left + col * sigColWidth;
        doc.moveTo(x, sigY).lineTo(x + sigColWidth - 24, sigY).strokeColor("#999").stroke();
        doc.text(label, x, sigY + 4, { width: sigColWidth - 24 });
      });

      const stampY = sigY + 60;
      doc.moveTo(left, stampY).lineTo(left + sigColWidth - 24, stampY).strokeColor("#999").stroke();
      doc.text("Official Police Station Stamp", left, stampY + 4, { width: sigColWidth - 24 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildComplaintReceipt };
