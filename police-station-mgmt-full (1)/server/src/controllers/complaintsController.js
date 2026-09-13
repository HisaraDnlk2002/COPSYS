const fs = require("fs");
const path = require("path");
const Complaint = require("../models/Complaint");
const User = require("../models/User");
const { buildComplaintReceipt } = require("../utils/complaintReceiptBuilder");
const { logAuditForActor } = require("../utils/auditLogger");
const { UPLOAD_DIR } = require("../middleware/complaintAttachmentUpload");
const { generateAlert } = require("../utils/alerts");

// Ref IDs follow the physical Complaint Book they're logged under — each
// book (IB, CR, TR, ...) keeps its own running sequence, e.g. the 7th
// entry under the Information Book is "IB 0007", independent of how many
// Crime Register entries exist. Matches how the paper registers are kept.
async function generateRefId(complaintBook) {
  const count = await Complaint.countDocuments({ complaintBook });
  return `${complaintBook} ${String(count + 1).padStart(4, "0")}`;
}

// GET /api/complaints — registry view: oic, duty_officer, officer, admin (own station)
// GET /api/complaints?assignedToMe=true — "My assigned complaints" on the Officer Dashboard
//
// Deliberately doesn't .populate("assignedOfficerId") — the OIC dashboard's
// assign dropdown compares assignedOfficerId against a separately-fetched
// officer list by raw id string, so it needs to stay a plain id. The
// registry table just needs a name to display, so we attach that
// separately as `assignedOfficerName` instead of replacing the id field.
// `registeredByName` (who filed the complaint) is resolved the same way.
async function list(req, res) {
  try {
    const filter = { stationId: req.user.stationId };
    if (req.query.assignedToMe === "true") {
      filter.assignedOfficerId = req.user.uid;
    }
    const complaints = await Complaint.find(filter).sort({ createdAt: -1 });

    const officerIds = [
      ...new Set(
        complaints
          .flatMap((c) => [c.assignedOfficerId?.toString(), c.registeredBy?.toString()])
          .filter(Boolean)
      ),
    ];
    const officers = await User.find({ _id: { $in: officerIds } }).select("fullName");
    const officerNameById = new Map(officers.map((o) => [o._id.toString(), o.fullName]));

    return res.json(
      complaints.map((c) => {
        const json = c.toJSON();
        json.assignedOfficerName = json.assignedOfficerId
          ? officerNameById.get(json.assignedOfficerId.toString()) || ""
          : "";
        json.registeredByName = json.registeredBy
          ? officerNameById.get(json.registeredBy.toString()) || ""
          : "";
        return json;
      })
    );
  } catch (err) {
    console.error("list complaints error:", err);
    return res.status(500).json({ error: "Could not load complaints" });
  }
}

// GET /api/complaints/log — oic only. Same underlying data as the
// registry, but this is the broader audit/history view (page 15's
// "Case Logs" / "Recent Cases" screen) — includes registeredBy and
// assignment history that the plain registry list doesn't need to show.
async function listLog(req, res) {
  try {
    const complaints = await Complaint.find({ stationId: req.user.stationId })
      .populate("registeredBy", "fullName rankAndNumber")
      .populate("assignedOfficerId", "fullName rankAndNumber")
      .sort({ createdAt: -1 });
    return res.json(complaints.map((c) => c.toJSON()));
  } catch (err) {
    console.error("listLog error:", err);
    return res.status(500).json({ error: "Could not load complaint log" });
  }
}

// GET /api/complaints/:id
async function getOne(req, res) {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: "Complaint not found" });
    return res.json(complaint.toJSON());
  } catch (err) {
    console.error("getOne complaint error:", err);
    return res.status(500).json({ error: "Could not load complaint" });
  }
}

// GET /api/complaints/:id/receipt — same access as getOne. Regenerates a
// formal "Complaint Acknowledgement / Receipt" PDF on demand (not stored)
// so it's always in sync with the complaint's current status, and can be
// reprinted later if the complainant's copy is lost.
async function downloadReceipt(req, res) {
  try {
    const complaint = await Complaint.findOne({ _id: req.params.id, stationId: req.user.stationId }).populate(
      "registeredBy",
      "fullName rankAndNumber"
    );
    if (!complaint) return res.status(404).json({ error: "Complaint not found" });

    const pdfBuffer = await buildComplaintReceipt(complaint);
    const safeName = complaint.refId.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="complaint-receipt-${safeName}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("downloadReceipt error:", err);
    return res.status(500).json({ error: "Could not generate the complaint receipt" });
  }
}

const SEVERITY_VALUES = ["General", "Serious", "Grave Crime"];

// POST /api/complaints — oic, duty_officer, officer
// Matches the "Complaint Registration" form: classification + complainant
// details + incident particulars.
async function create(req, res) {
  const {
    complaintBook,
    title,
    complaintSource,
    priority,
    fullName,
    nic,
    passportId,
    contactNumber,
    occupation,
    address,
    category,
    severity,
    dateOfIncident,
    incidentTime,
    incidentLocation,
    description,
  } = req.body;

  if (!complaintBook || !title || !fullName || !address || !category || !dateOfIncident || !incidentLocation || !description) {
    return res.status(400).json({ error: "Please complete all required fields" });
  }
  if (!nic && !passportId) {
    return res.status(400).json({ error: "Please provide either a NIC Number or Passport ID" });
  }

  try {
    const complaint = await Complaint.create({
      refId: await generateRefId(complaintBook),
      complaintBook,
      title,
      complaintSource,
      priority,
      complainant: { fullName, nic, passportId, contactNumber, occupation, address },
      category,
      severity: SEVERITY_VALUES.includes(severity) ? severity : "General",
      dateOfIncident,
      incidentTime,
      incidentLocation,
      description,
      registeredBy: req.user.uid,
      stationId: req.user.stationId,
    });
    logAuditForActor(req, { action: `Registered Complaint: ${complaint.refId}`, module: "Complaints" });

    // A Grave Crime complaint reaches the station's OIC immediately (see
    // utils/sseHub.js) rather than waiting for them to next open their
    // Incident & Complaint Monitor — same "only one OIC per station"
    // invariant already enforced in usersController.js.
    if (complaint.severity === "Grave Crime") {
      const oic = await User.findOne({ stationId: req.user.stationId, role: "oic" });
      if (oic) {
        await generateAlert({
          alertType: "critical_complaint",
          title: "Critical Complaint Filed",
          message: `${complaint.refId}: ${complaint.title}`,
          recipientId: oic._id,
          stationId: req.user.stationId,
        });
      }
    }

    return res.status(201).json(complaint.toJSON());
  } catch (err) {
    console.error("create complaint error:", err);
    return res.status(500).json({ error: "Could not register complaint" });
  }
}

// PATCH /api/complaints/:id — oic, duty_officer (status/severity updates)
async function update(req, res) {
  const { status, severity, assignedOfficerId } = req.body;

  try {
    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      {
        ...(status && { status }),
        ...(severity && { severity }),
        ...(assignedOfficerId !== undefined && { assignedOfficerId }),
      },
      { new: true }
    );
    if (!complaint) return res.status(404).json({ error: "Complaint not found" });

    const changes = [];
    if (status) changes.push(`status → ${status}`);
    if (severity) changes.push(`severity → ${severity}`);
    if (assignedOfficerId !== undefined) changes.push("reassigned");
    logAuditForActor(req, {
      action: `Updated Complaint ${complaint.refId}${changes.length ? ` (${changes.join(", ")})` : ""}`,
      module: "Complaints",
    });

    return res.json(complaint.toJSON());
  } catch (err) {
    console.error("update complaint error:", err);
    return res.status(500).json({ error: "Could not update complaint" });
  }
}

// PATCH /api/complaints/:id/assign — oic only. The "Assign" button on the
// Incident & Complaint Monitor table (page 13).
async function assign(req, res) {
  const { assignedOfficerId } = req.body;

  if (!assignedOfficerId) {
    return res.status(400).json({ error: "An officer must be selected to assign" });
  }

  try {
    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      { assignedOfficerId, status: "investigating" },
      { new: true }
    );
    if (!complaint) return res.status(404).json({ error: "Complaint not found" });

    const officer = await User.findById(assignedOfficerId).select("fullName");
    logAuditForActor(req, {
      action: `Assigned Complaint ${complaint.refId} to ${officer?.fullName || "an officer"}`,
      module: "Complaints",
    });

    return res.json(complaint.toJSON());
  } catch (err) {
    console.error("assign complaint error:", err);
    return res.status(500).json({ error: "Could not assign complaint" });
  }
}

// POST /api/complaints/:id/notes — oic, duty_officer, officer, admin.
// multipart/form-data: `text` (optional if at least one file is
// attached) + up to 5 `attachments` files (handled by
// complaintAttachmentUpload.js before this runs). Turns the registry
// from a bare status tracker into an actual running case file —
// "investigating since...", "witness statement taken", a photo of the
// scene — each entry timestamped and attributed to whoever added it.
async function addNote(req, res) {
  const text = (req.body.text || "").trim();
  const files = req.files || [];

  if (!text && files.length === 0) {
    // Nothing was actually uploaded yet (fileFilter/limits rejected
    // everything before multer even got here) vs. a genuinely empty
    // submission both land here — same message covers both.
    return res.status(400).json({ error: "Add a note or at least one attachment" });
  }

  try {
    const complaint = await Complaint.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!complaint) return res.status(404).json({ error: "Complaint not found" });

    const author = await User.findById(req.user.uid).select("fullName");

    complaint.notes.push({
      authorId: req.user.uid,
      authorName: author?.fullName || "Unknown",
      text,
      attachments: files.map((f) => ({
        filename: f.filename,
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
      })),
    });
    await complaint.save();

    logAuditForActor(req, {
      action: `Added Case Note to Complaint ${complaint.refId}${files.length ? ` (${files.length} attachment${files.length > 1 ? "s" : ""})` : ""}`,
      module: "Complaints",
    });

    return res.status(201).json(complaint.toJSON());
  } catch (err) {
    console.error("addNote error:", err);
    return res.status(500).json({ error: "Could not add case note" });
  }
}

// GET /api/complaints/:id/notes/:noteId/attachments/:attachmentId — same
// access as getOne. The on-disk filename is a random token (never the
// officer's original name — see complaintAttachmentUpload.js), so there's
// no path-traversal surface here: it's whatever was already stored on
// this exact attachment subdocument, not anything from the request.
async function downloadAttachment(req, res) {
  try {
    const complaint = await Complaint.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!complaint) return res.status(404).json({ error: "Complaint not found" });

    const note = complaint.notes.id(req.params.noteId);
    if (!note) return res.status(404).json({ error: "Note not found" });

    const attachment = note.attachments.id(req.params.attachmentId);
    if (!attachment) return res.status(404).json({ error: "Attachment not found" });

    const filePath = path.join(UPLOAD_DIR, attachment.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File no longer exists on the server" });
    }

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${attachment.originalName}"`);
    return res.sendFile(filePath);
  } catch (err) {
    console.error("downloadAttachment error:", err);
    return res.status(500).json({ error: "Could not download attachment" });
  }
}

module.exports = { list, listLog, getOne, create, update, assign, downloadReceipt, addNote, downloadAttachment };
