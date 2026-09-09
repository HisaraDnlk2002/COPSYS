const mongoose = require("mongoose");

// Report types we can actually build from real collections. Sidebar
// groups on the Reports page (see dummyReportEngineSections) show a few
// extra categories (Financial Logs, Traffic Division, Admin & HR,
// Logistics) that aren't backed by any collection yet — deliberately
// left out of this enum rather than faking data for them. Add a new
// type here (and a matching branch in reportsController's
// `gatherReportData`) once a real source exists.
const REPORT_TYPES = ["duty", "leave", "inventory", "crime"];
const REPORT_FORMATS = ["pdf", "csv"];
const REPORT_STATUSES = ["Complete", "Archived", "Failed"];

const reportExportSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: REPORT_TYPES, required: true },
    format: { type: String, enum: REPORT_FORMATS, required: true },

    // The window the report covers — re-used at download time to
    // regenerate the file, since we don't persist the binary itself
    // (see reportsController's downloadReport).
    dateFrom: { type: Date, required: true },
    dateTo: { type: Date, required: true },

    generatedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Denormalized so the activity log still reads correctly even if
    // the generating officer's account is later renamed or removed.
    generatedByName: { type: String, required: true },

    status: { type: String, enum: REPORT_STATUSES, default: "Complete" },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

// Frontend tables/handlers key off `id`, not `_id` — see User.js for the
// same convention.
reportExportSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("ReportExport", reportExportSchema);
module.exports.REPORT_TYPES = REPORT_TYPES;
module.exports.REPORT_FORMATS = REPORT_FORMATS;
module.exports.REPORT_STATUSES = REPORT_STATUSES;