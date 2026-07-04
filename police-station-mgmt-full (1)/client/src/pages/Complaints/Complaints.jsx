import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { Button, InputField, Card, Table, Badge, Loader } from "../../components";
import { getComplaints, registerComplaint } from "../../services/complaints";
import "./Complaints.css";

const CATEGORY_OPTIONS = [
  { value: "Theft", label: "Theft" },
  { value: "Assault", label: "Assault" },
  { value: "Residential Burglary", label: "Residential Burglary" },
  { value: "Vehicle Theft", label: "Vehicle Theft" },
  { value: "Public Disturbance", label: "Public Disturbance" },
  { value: "Public Nuisance", label: "Public Nuisance" },
  { value: "Traffic", label: "Traffic" },
  { value: "Missing Person", label: "Missing Person" },
  { value: "Other", label: "Other" },
];

const EMPTY_FORM = {
  fullName: "",
  nic: "",
  passportId: "",
  contactNumber: "",
  occupation: "",
  address: "",
  category: "",
  dateOfIncident: "",
  description: "",
};

export function ComplaintsPage() {
  const { user } = useAuth();
  const canManage = ["oic", "duty_officer", "officer"].includes(user?.role);

  const [view, setView] = useState("list"); // "list" | "register"
  const [loading, setLoading] = useState(true);
  const [complaints, setComplaints] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState(null);

  async function loadData() {
    setLoading(true);
    try {
      setComplaints(await getComplaints());
    } catch (err) {
      console.error("Failed to load complaints:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    getComplaints()
      .then((res) => {
        if (!cancelled) setComplaints(res);
      })
      .catch((err) => console.error("Failed to load complaints:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function clearForm() {
    setForm(EMPTY_FORM);
    setFormError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");

    const required = ["fullName", "nic", "contactNumber", "address", "category", "dateOfIncident", "description"];
    if (required.some((key) => !form[key])) {
      setFormError("Please complete all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      await registerComplaint(form);
      clearForm();
      setView("list");
      await loadData();
    } catch (err) {
      setFormError(err.message || "Could not register complaint");
    } finally {
      setSubmitting(false);
    }
  }

  // Real records nest complainant fields under `complainant`; dummy data
  // keeps them flat. This helper reads either shape safely.
  function complainantName(row) {
    return row.complainant?.fullName || row.fullName || "";
  }

  const filteredComplaints = complaints.filter((row) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      row.refId?.toLowerCase().includes(q) ||
      complainantName(row).toLowerCase().includes(q) ||
      row.category?.toLowerCase().includes(q) ||
      row.description?.toLowerCase().includes(q) ||
      (row.complainant?.nic || "").toLowerCase().includes(q) ||
      (row.complainant?.passportId || "").toLowerCase().includes(q)
    );
  });

  const columns = [
    { key: "refId", label: "Ref ID" },
    { key: "fullName", label: "Complainant", render: (row) => complainantName(row) },
    { key: "category", label: "Category" },
    { key: "dateOfIncident", label: "Date of Incident" },
    {
      key: "status",
      label: "Status",
      render: (row) =>
        row.severity === "critical" ? (
          <Badge tone="danger">Critical</Badge>
        ) : (
          <Badge status={row.status} />
        ),
    },
    {
      key: "actions",
      label: "",
      render: (row) => (
        <Button variant="ghost" type="button" onClick={() => setViewing(row)}>
          View
        </Button>
      ),
    },
  ];

  if (loading) return <Loader label="Loading complaints…" />;

  if (view === "register") {
    return (
      <div>
        <div className="complaints-header">
          <div>
            <h1>COMPLAINT REGISTRATION</h1>
            <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
              Official intake for citizen complaints, incident reports, and public statements
            </p>
          </div>
        </div>

        <Card variant="panel">
          <form onSubmit={handleSubmit}>
            <h3 className="section-label">Complaint Details</h3>
            <div className="complaint-form-grid">
              <InputField label="Full Name" required value={form.fullName} onChange={(e) => updateField("fullName", e.target.value)} />
              <InputField label="NIC Number" required value={form.nic} onChange={(e) => updateField("nic", e.target.value)} />
              <InputField label="Passport ID (Optional)" value={form.passportId} onChange={(e) => updateField("passportId", e.target.value)} placeholder="For foreign nationals" />
              <InputField label="Contact Number" required value={form.contactNumber} onChange={(e) => updateField("contactNumber", e.target.value)} />
              <InputField label="Occupation (Optional)" value={form.occupation} onChange={(e) => updateField("occupation", e.target.value)} />
              <div className="field-full">
                <InputField label="Residential Address" type="textarea" rows={2} required value={form.address}
                  onChange={(e) => updateField("address", e.target.value)} placeholder="Complete Permanent Address" />
              </div>
            </div>

            <h3 className="section-label">Incident Particulars</h3>
            <div className="complaint-form-grid">
              <InputField label="Complaint Category" type="select" required value={form.category}
                onChange={(e) => updateField("category", e.target.value)} options={CATEGORY_OPTIONS} />
              <InputField label="Date of Incident" type="date" required value={form.dateOfIncident}
                onChange={(e) => updateField("dateOfIncident", e.target.value)} />
              <div className="field-full">
                <InputField label="Detailed Description" type="textarea" required value={form.description}
                  onChange={(e) => updateField("description", e.target.value)} placeholder="Complete account of the incident" />
              </div>
            </div>

            {formError && <p style={{ color: "var(--color-danger)", marginBottom: 16 }}>{formError}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <Button variant="ghost" type="button" onClick={() => { clearForm(); setView("list"); }}>
                Clear Form
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="complaints-header">
        <h1>Complaints Registry</h1>
        {canManage && (
          <Button variant="primary" onClick={() => setView("register")}>
            Register complaint
          </Button>
        )}
      </div>

      <div style={{ marginBottom: 16, maxWidth: 360 }}>
        <InputField
          label="Search complaints"
          placeholder="Search by ref ID, complainant, category, NIC…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card variant="panel">
        <Table columns={columns} data={filteredComplaints} emptyMessage="No complaints match your search" />
      </Card>

      {viewing && (
        <div
          onClick={() => setViewing(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, width: "90%" }}>
            <Card variant="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Complaint {viewing.refId}</h3>
                <Button variant="ghost" type="button" onClick={() => setViewing(null)}>Close</Button>
              </div>

              <h4 className="section-label">Complainant</h4>
              <p><strong>Name:</strong> {complainantName(viewing)}</p>
              <p><strong>NIC:</strong> {viewing.complainant?.nic || "—"}</p>
              <p><strong>Passport ID:</strong> {viewing.complainant?.passportId || "—"}</p>
              <p><strong>Contact Number:</strong> {viewing.complainant?.contactNumber || "—"}</p>
              <p><strong>Occupation:</strong> {viewing.complainant?.occupation || "—"}</p>
              <p><strong>Address:</strong> {viewing.complainant?.address || "—"}</p>

              <h4 className="section-label">Incident</h4>
              <p><strong>Category:</strong> {viewing.category}</p>
              <p><strong>Date of Incident:</strong> {viewing.dateOfIncident?.slice ? viewing.dateOfIncident.slice(0, 10) : viewing.dateOfIncident}</p>
              <p><strong>Description:</strong> {viewing.description || "—"}</p>
              <p>
                <strong>Status:</strong>{" "}
                {viewing.severity === "critical" ? <Badge tone="danger">Critical</Badge> : <Badge status={viewing.status} />}
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
