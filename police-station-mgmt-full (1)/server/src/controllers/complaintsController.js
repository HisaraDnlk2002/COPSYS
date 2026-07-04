const Complaint = require("../models/Complaint");

async function generateRefId() {
  const count = await Complaint.countDocuments();
  return `CMP-${String(count + 1).padStart(3, "0")}`;
}

// GET /api/complaints — registry view: oic, duty_officer, officer (own station)
async function list(req, res) {
  try {
    const complaints = await Complaint.find({ stationId: req.user.stationId }).sort({ createdAt: -1 });
    return res.json(complaints.map((c) => c.toJSON()));
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

// POST /api/complaints — oic, duty_officer, officer
// Matches the "Complaint Registration" form: complainant details + incident particulars
async function create(req, res) {
  const { fullName, nic, passportId, contactNumber, occupation, address, category, dateOfIncident, description, severity } = req.body;

  if (!fullName || !nic || !contactNumber || !address || !category || !dateOfIncident || !description) {
    return res.status(400).json({ error: "Please complete all required fields" });
  }

  try {
    const complaint = await Complaint.create({
      refId: await generateRefId(),
      complainant: { fullName, nic, passportId, contactNumber, occupation, address },
      category,
      dateOfIncident,
      description,
      severity: severity === "critical" ? "critical" : "normal",
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
