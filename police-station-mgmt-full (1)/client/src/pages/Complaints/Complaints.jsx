import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, InputField, Card, Table, Badge, Loader, AssignmentCell } from "../../components";
import { getComplaints, registerComplaint, updateComplaintStatus, assignComplaint } from "../../services/complaints";
import { listUsers } from "../../services/users";
import { formatDateAndTime } from "../../utils/formatDate";
import "./Complaints.css";

const ASSIGNABLE_ROLES = ["duty_officer", "officer"];

// Register names are official/abbreviated terms — left untranslated,
// matching how they're printed on the physical station registers.
const COMPLAINT_BOOK_OPTIONS = [
  { value: "IB", label: "IB — Information Book" },
  { value: "CR", label: "CR — Crime Register" },
  { value: "TR", label: "TR — Traffic Register" },
  { value: "LPR", label: "LPR — Lost Property Register" },
  { value: "MPR", label: "MPR — Missing Persons Register" },
  { value: "WCD", label: "WCD — Women & Children's Desk" },
  { value: "DVR", label: "DVR — Domestic Violence Register" },
  { value: "GCR", label: "GCR — General Complaint Register" },
];

const EMPTY_FORM = {
  complaintBook: "",
  title: "",
  complaintSource: "Walk-in",
  priority: "Medium",
  fullName: "",
  nic: "",
  passportId: "",
  contactNumber: "",
  occupation: "",
  address: "",
  category: "",
  severity: "General",
  dateOfIncident: "",
  incidentTime: "",
  incidentLocation: "",
  description: "",
};

export function ComplaintsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const canManage = ["oic", "duty_officer", "officer"].includes(user?.role);
  const canChangeStatus = ["oic", "admin"].includes(user?.role);
  const canAssign = user?.role === "oic";

  const CATEGORY_OPTIONS = [
    { value: "Theft", label: t("complaints.categoryTheft") },
    { value: "Assault", label: t("complaints.categoryAssault") },
    { value: "Residential Burglary", label: t("complaints.categoryResidentialBurglary") },
    { value: "Vehicle Theft", label: t("complaints.categoryVehicleTheft") },
    { value: "Public Disturbance", label: t("complaints.categoryPublicDisturbance") },
    { value: "Public Nuisance", label: t("complaints.categoryPublicNuisance") },
    { value: "Traffic", label: t("complaints.categoryTraffic") },
    { value: "Missing Person", label: t("complaints.categoryMissingPerson") },
    { value: "Other", label: t("complaints.categoryOther") },
  ];

  const SEVERITY_OPTIONS = [
    { value: "General", label: t("complaints.severityGeneral") },
    { value: "Serious", label: t("complaints.severitySerious") },
    { value: "Grave Crime", label: t("complaints.severityGraveCrime") },
  ];

  const PRIORITY_OPTIONS = [
    { value: "Low", label: t("complaints.priorityLow") },
    { value: "Medium", label: t("complaints.priorityMedium") },
    { value: "High", label: t("complaints.priorityHigh") },
    { value: "Urgent", label: t("complaints.priorityUrgent") },
  ];

  const SOURCE_OPTIONS = [
    { value: "Walk-in", label: t("complaints.sourceWalkIn") },
    { value: "Telephone", label: t("complaints.sourceTelephone") },
    { value: "Online", label: t("complaints.sourceOnline") },
    { value: "Referral", label: t("complaints.sourceReferral") },
  ];

  const STATUS_OPTIONS = [
    { value: "open", label: t("complaints.statusOpen") },
    { value: "investigating", label: t("complaints.statusInvestigating") },
    { value: "paused", label: t("complaints.statusPaused") },
    { value: "closed", label: t("complaints.statusClosed") },
  ];

  const [view, setView] = useState("list"); // "list" | "register"
  const [loading, setLoading] = useState(true);
  const [complaints, setComplaints] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState(null);
  const [statusSaving, setStatusSaving] = useState(false);

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

  useEffect(() => {
    if (!canAssign) return;
    let cancelled = false;
    listUsers()
      .then((res) => {
        if (!cancelled) setOfficers(res.filter((u) => ASSIGNABLE_ROLES.includes(u.role)));
      })
      .catch((err) => console.error("Failed to load officers:", err));
    return () => {
      cancelled = true;
    };
  }, [canAssign]);

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

    const required = ["complaintBook", "title", "fullName", "address", "category", "dateOfIncident", "incidentLocation", "description"];
    if (required.some((key) => !form[key])) {
      setFormError(t("complaints.errRequiredFields"));
      return;
    }
    if (!form.nic && !form.passportId) {
      setFormError(t("complaints.errNicOrPassport"));
      return;
    }

    setSubmitting(true);
    try {
      await registerComplaint(form);
      clearForm();
      setView("list");
      await loadData();
    } catch (err) {
      setFormError(err.message || t("complaints.errRegisterFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  // Real records nest complainant fields under `complainant`; dummy data
  // keeps them flat. This helper reads either shape safely.
  function complainantName(row) {
    return row.complainant?.fullName || row.fullName || "";
  }

  async function handleStatusChange(id, status) {
    setStatusSaving(true);
    try {
      const updated = await updateComplaintStatus(id, status);
      setComplaints((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      setViewing((prev) => (prev && prev.id === id ? { ...prev, ...updated } : prev));
    } catch (err) {
      console.error("Failed to update complaint status:", err);
      alert(err.message || "Could not update complaint status");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleAssign(complaintId, officerId) {
    const updated = await assignComplaint(complaintId, officerId);
    setComplaints((prev) => prev.map((c) => (c.id === complaintId ? { ...c, ...updated } : c)));
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
    { key: "refId", label: t("complaints.colRefId") },
    { key: "fullName", label: t("complaints.colComplainant"), render: (row) => complainantName(row) },
    { key: "category", label: t("complaints.colCategory") },
    { key: "dateOfIncident", label: t("complaints.colDateTimeIncident"), render: (row) => formatDateAndTime(row.dateOfIncident, row.incidentTime) },
    {
      key: "status",
      label: t("common.status"),
      render: (row) =>
        row.severity === "Grave Crime" ? (
          <Badge tone="danger">{t("status.critical")}</Badge>
        ) : (
          <Badge status={row.status} />
        ),
    },
    {
      key: "assignedOfficerName",
      label: t("complaints.colAssignedOfficer"),
      render: (row) =>
        canAssign ? (
          <AssignmentCell complaint={row} officers={officers} onAssign={handleAssign} />
        ) : (
          row.assignedOfficerName || <span style={{ color: "var(--color-text-muted)" }}>{t("common.unassigned")}</span>
        ),
    },
    {
      key: "actions",
      label: "",
      render: (row) => (
        <Button variant="ghost" type="button" onClick={() => setViewing(row)}>
          {t("common.view")}
        </Button>
      ),
    },
  ];

  if (loading) return <Loader label={t("complaints.loading")} />;

  if (view === "register") {
    return (
      <div>
        <div className="complaints-header">
          <div>
            <h1>{t("complaints.registrationTitle")}</h1>
            <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
              {t("complaints.registrationSubtitle")}
            </p>
          </div>
        </div>

        <Card variant="panel">
          <form onSubmit={handleSubmit}>
            <h3 className="section-label">{t("complaints.registerClassification")}</h3>
            <div className="complaint-form-grid">
              <InputField label={t("complaints.complaintBook")} type="select" required value={form.complaintBook}
                onChange={(e) => updateField("complaintBook", e.target.value)} options={COMPLAINT_BOOK_OPTIONS} />
              <InputField label={t("complaints.complaintTitle")} required value={form.title}
                onChange={(e) => updateField("title", e.target.value)} placeholder={t("complaints.complaintTitlePlaceholder")} />
              <InputField label={t("complaints.complaintSource")} type="select" value={form.complaintSource}
                onChange={(e) => updateField("complaintSource", e.target.value)} options={SOURCE_OPTIONS} />
              <InputField label={t("complaints.priority")} type="select" value={form.priority}
                onChange={(e) => updateField("priority", e.target.value)} options={PRIORITY_OPTIONS} />
            </div>

            <h3 className="section-label">{t("complaints.complaintDetails")}</h3>
            <div className="complaint-form-grid">
              <InputField label={t("complaints.fullName")} required value={form.fullName} onChange={(e) => updateField("fullName", e.target.value)} />
              <InputField label={t("complaints.contactNumber")} value={form.contactNumber} onChange={(e) => updateField("contactNumber", e.target.value)} />
              <InputField label={t("complaints.nicNumber")} value={form.nic} onChange={(e) => updateField("nic", e.target.value)}
                helperText={t("complaints.nicOrPassportHelper")} />
              <InputField label={t("complaints.passportId")} value={form.passportId} onChange={(e) => updateField("passportId", e.target.value)}
                helperText={t("complaints.nicOrPassportHelper")} />
              <InputField label={t("complaints.occupationOptional")} value={form.occupation} onChange={(e) => updateField("occupation", e.target.value)} />
              <div className="field-full">
                <InputField label={t("complaints.residentialAddress")} type="textarea" rows={2} required value={form.address}
                  onChange={(e) => updateField("address", e.target.value)} placeholder={t("complaints.addressPlaceholder")} />
              </div>
            </div>

            <h3 className="section-label">{t("complaints.incidentParticulars")}</h3>
            <div className="complaint-form-grid">
              <InputField label={t("complaints.complaintCategory")} type="select" required value={form.category}
                onChange={(e) => updateField("category", e.target.value)} options={CATEGORY_OPTIONS} />
              <InputField label={t("complaints.severity")} type="select" value={form.severity}
                onChange={(e) => updateField("severity", e.target.value)} options={SEVERITY_OPTIONS} />
              <InputField label={t("complaints.dateOfIncident")} type="date" required value={form.dateOfIncident}
                onChange={(e) => updateField("dateOfIncident", e.target.value)} />
              <InputField label={t("complaints.timeOfIncident")} type="time" value={form.incidentTime}
                onChange={(e) => updateField("incidentTime", e.target.value)} />
              <div className="field-full">
                <InputField label={t("complaints.incidentLocation")} required value={form.incidentLocation}
                  onChange={(e) => updateField("incidentLocation", e.target.value)} placeholder={t("complaints.incidentLocationPlaceholder")} />
              </div>
              <div className="field-full">
                <InputField label={t("complaints.detailedDescription")} type="textarea" required value={form.description}
                  onChange={(e) => updateField("description", e.target.value)} placeholder={t("complaints.descriptionPlaceholder")} />
              </div>
            </div>

            {formError && <p style={{ color: "var(--color-danger)", marginBottom: 16 }}>{formError}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <Button variant="ghost" type="button" onClick={() => { clearForm(); setView("list"); }}>
                {t("complaints.clearForm")}
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? t("complaints.submitting") : t("complaints.submit")}
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
        <h1>{t("complaints.registryTitle")}</h1>
        {canManage && (
          <Button variant="primary" onClick={() => setView("register")}>
            {t("complaints.registerComplaint")}
          </Button>
        )}
      </div>

      <div style={{ marginBottom: 16, maxWidth: 360 }}>
        <InputField
          label={t("complaints.searchComplaints")}
          placeholder={t("complaints.searchComplaintsPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card variant="panel">
        <Table columns={columns} data={filteredComplaints} emptyMessage={t("complaints.noComplaintsMatch")} />
      </Card>

      {viewing && (
        <div
          onClick={() => setViewing(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, width: "90%", maxHeight: "90vh", overflowY: "auto" }}>
            <Card variant="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{t("complaints.complaintPrefix")} {viewing.refId}</h3>
                <Button variant="ghost" type="button" onClick={() => setViewing(null)}>{t("complaints.close")}</Button>
              </div>

              <h3 className="section-label">{t("complaints.complainant")}</h3>
              <div className="complaint-form-grid">
                <InputField label={t("complaints.fullName")} readOnly value={complainantName(viewing)} />
                <InputField label={t("complaints.nicNumber")} readOnly value={viewing.complainant?.nic || "—"} />
                <InputField label={t("complaints.passportId")} readOnly value={viewing.complainant?.passportId || "—"} />
                <InputField label={t("complaints.contactNumber")} readOnly value={viewing.complainant?.contactNumber || "—"} />
                <InputField label={t("complaints.occupation")} readOnly value={viewing.complainant?.occupation || "—"} />
                <div className="field-full">
                  <InputField label={t("complaints.residentialAddress")} type="textarea" rows={2} readOnly value={viewing.complainant?.address || "—"} />
                </div>
              </div>

              <h3 className="section-label">{t("complaints.incidentParticulars")}</h3>
              <div className="complaint-form-grid">
                <InputField label={t("complaints.complaintCategory")} readOnly value={viewing.category} />
                <InputField
                  label={t("complaints.colDateTimeIncident")}
                  readOnly
                  value={formatDateAndTime(viewing.dateOfIncident, viewing.incidentTime)}
                />
                <div className="field-full">
                  <InputField label={t("complaints.detailedDescription")} type="textarea" readOnly value={viewing.description || "—"} />
                </div>
              </div>

              <h3 className="section-label">{t("complaints.status")}</h3>
              {viewing.severity === "Grave Crime" && <Badge tone="danger">{t("status.critical")}</Badge>}
              {canChangeStatus ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                  <select
                    className="field-control"
                    style={{ maxWidth: 220 }}
                    value={viewing.status}
                    disabled={statusSaving}
                    onChange={(e) => handleStatusChange(viewing.id, e.target.value)}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {statusSaving && <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{t("complaints.saving")}</span>}
                </div>
              ) : (
                <Badge status={viewing.status} />
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
