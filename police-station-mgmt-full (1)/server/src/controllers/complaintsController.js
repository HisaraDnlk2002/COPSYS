const Complaint = require("../models/Complaint");
const User = require("../models/User");

async function generateRefId() {
  const count = await Complaint.countDocuments();
  return `CMP-${String(count + 1).padStart(3, "0")}`;
}

// GET /api/complaints — registry view: oic, duty_officer, officer, admin (own station)
// GET /api/complaints?assignedToMe=true — "My assigned complaints" on the Officer Dashboard
//
// Deliberately doesn't .populate("assignedOfficerId") — the OIC dashboard's
// assign dropdown compares assignedOfficerId against a separately-fetched
// officer list by raw id string, so it needs to stay a plain id. The
// registry table just needs a name to display, so we attach that
// separately as `assignedOfficerName` instead of replacing the id field.
async function list(req, res) {
  try {
    const filter = { stationId: req.user.stationId };
    if (req.query.assignedToMe === "true") {
      filter.assignedOfficerId = req.user.uid;
    }
    const complaints = await Complaint.find(filter).sort({ createdAt: -1 });

    const officerIds = [...new Set(complaints.map((c) => c.assignedOfficerId?.toString()).filter(Boolean))];
    const officers = await User.find({ _id: { $in: officerIds } }).select("fullName");
    const officerNameById = new Map(officers.map((o) => [o._id.toString(), o.fullName]));

    return res.json(
      complaints.map((c) => {
        const json = c.toJSON();
        json.assignedOfficerName = json.assignedOfficerId
          ? officerNameById.get(json.assignedOfficerId) || ""
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
      refId: await generateRefId(),
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
    return res.json(complaint.toJSON());
  } catch (err) {
    console.error("assign complaint error:", err);
    return res.status(500).json({ error: "Could not assign complaint" });
  }
}

module.exports = { list, listLog, getOne, create, update, assign };
