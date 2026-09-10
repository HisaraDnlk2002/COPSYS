// One-off migration: renumbers every existing complaint's refId to the
// per-Complaint-Book format used by generateRefId() in
// complaintsController.js (e.g. "IB 0001"), replacing the old shared
// "CMP-001" counter.
//
// Complaints are renumbered in creation order, separately within each
// book, so the sequence a station officer would recognize from the
// physical register is preserved (the 1st Information Book entry becomes
// "IB 0001", the 2nd becomes "IB 0002", etc.) — regardless of what other
// books had entries logged in between.
//
// Safe to re-run: a complaint whose refId already matches its correct
// new-format value is left untouched (and not re-saved).
//
// Usage:  node src/migrateComplaintRefIds.js

require("dotenv").config();

// See src/index.js for why — some mobile-hotspot networks hijack the
// default DNS path for the Atlas hostnames even with 8.8.8.8 configured
// system-wide, so this forces Node's own resolver to use it directly.
require("dns").setServers(["8.8.8.8", "8.8.4.4"]);

const mongoose = require("mongoose");
const { connectDB } = require("./config/db");
const Complaint = require("./models/Complaint");

async function migrate() {
  await connectDB();

  const complaints = await Complaint.find({}).sort({ complaintBook: 1, createdAt: 1 });

  const seqByBook = {};
  let updated = 0;
  let skipped = 0;

  for (const c of complaints) {
    if (!c.complaintBook) {
      console.warn(`Skipping ${c.id} (${c.refId}) — no complaintBook set`);
      skipped++;
      continue;
    }

    const book = c.complaintBook;
    seqByBook[book] = (seqByBook[book] || 0) + 1;
    const newRefId = `${book} ${String(seqByBook[book]).padStart(4, "0")}`;

    if (c.refId === newRefId) continue;

    console.log(`${c.refId} -> ${newRefId}`);
    c.refId = newRefId;
    await c.save();
    updated++;
  }

  console.log(`\nDone. Renumbered ${updated} of ${complaints.length} complaint(s).`);
  if (skipped) console.log(`${skipped} complaint(s) skipped — missing complaintBook, fix manually.`);

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
