import { useEffect, useState } from "react";
import { Button, InputField, Card, StatCard, Table, Badge, Loader, Modal } from "../../components";
import { useLanguage } from "../../i18n/useLanguage";
import {
  listUsers,
  getPersonnelStats,
  createUser,
  updateUser,
  updateUserStatus,
  resetPassword,
} from "../../services/users";
import "./Personnel.css";

// Katunayake Airport Police Station's five branches.
const DEPARTMENT_OPTIONS = [
  { value: "Administration Branch (පාලන අංශය)", label: "Administration Branch (පාලන අංශය)" },
  { value: "Complaint Branch / Minor Complaints (පැමිණිලි අංශය)", label: "Complaint Branch / Minor Complaints (පැමිණිලි අංශය)" },
  { value: "Traffic Branch (ගමනාගමන අංශය)", label: "Traffic Branch (ගමනාගමන අංශය)" },
  { value: "Children & Women Bureau (ළමා හා කාන්තා කාර්යාංශය)", label: "Children & Women Bureau (ළමා හා කාන්තා කාර්යාංශය)" },
  { value: "General Duty Branch (සාමාන්‍ය රාජකාරි අංශය)", label: "General Duty Branch (සාමාන්‍ය රාජකාරි අංශය)" },
];

// Letters (any script) plus combining marks — needed so Sinhala vowel
// signs (e.g. the ු in "චතුර") aren't stripped, since those are Unicode
// "Mark" characters, not "Letter" — plus spaces and periods. Blocks
// digits and symbols while still allowing names like "Sgt. Bandara".
function sanitizeName(value) {
  return value.replace(/[^\p{L}\p{M}\s.]/gu, "");
}

const EMPTY_FORM = {
  fullName: "",
  rankAndNumber: "",
  department: "",
  role: "",
  phoneNumber: "",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  password: "",
};

// Fields the Edit User modal can change. Rank & Number (login username)
// and password are deliberately excluded — those go through their own
// dedicated flows (registration and Reset Password).
const EMPTY_EDIT_FORM = {
  fullName: "",
  department: "",
  role: "",
  phoneNumber: "",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
};

export function PersonnelPage() {
  const { t } = useLanguage();

  const ROLE_OPTIONS = [
    { value: "admin", label: t("personnel.roleAdmin") },
    { value: "oic", label: t("personnel.roleOic") },
    { value: "duty_officer", label: t("personnel.roleDutyOfficer") },
    { value: "inventory_officer", label: t("personnel.roleInventoryOfficer") },
    { value: "officer", label: t("personnel.roleOfficer") },
  ];

  const [view, setView] = useState("list"); // "list" | "register"
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdAccount, setCreatedAccount] = useState(null); // shows the credentials once, after creation

  const [resetModalUser, setResetModalUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const [viewUser, setViewUser] = useState(null); // officer shown in the "View More" modal

  const [editUser, setEditUser] = useState(null); // officer shown in the "Edit User" modal
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editError, setEditError] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  function loadData() {
    setLoading(true);
    Promise.all([listUsers(), getPersonnelStats()])
      .then(([usersRes, statsRes]) => {
        setUsers(usersRes);
        setStats(statsRes);
      })
      .catch((err) => console.error("Failed to load personnel:", err))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([listUsers(), getPersonnelStats()])
      .then(([usersRes, statsRes]) => {
        if (cancelled) return;
        setUsers(usersRes);
        setStats(statsRes);
      })
      .catch((err) => console.error("Failed to load personnel:", err))
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

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");

    const required = ["fullName", "rankAndNumber", "department", "role", "phoneNumber", "address", "password"];
    if (required.some((key) => !form[key])) {
      setFormError(t("personnel.errAllFields"));
      return;
    }
    if (form.password.length < 6) {
      setFormError(t("personnel.errPasswordLength"));
      return;
    }
    if (form.phoneNumber.length !== 10) {
      setFormError(t("personnel.errPhoneLength"));
      return;
    }

    setSubmitting(true);
    try {
      const created = await createUser(form);
      setCreatedAccount({ rankAndNumber: form.rankAndNumber, password: form.password, fullName: form.fullName });
      setForm(EMPTY_FORM);
      loadData();
      void created;
    } catch (err) {
      setFormError(err.message || t("personnel.errCreateFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleStatus(user) {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    await updateUserStatus(user.id, nextStatus);
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: nextStatus } : u)));
  }

  async function handleResetPassword() {
    if (!resetModalUser || newPassword.length < 6) return;
    setResetting(true);
    try {
      await resetPassword(resetModalUser.id, newPassword);
      setResetModalUser(null);
      setNewPassword("");
    } catch (err) {
      console.error("Reset password failed:", err);
    } finally {
      setResetting(false);
    }
  }

  // Opens the Edit User modal, pre-filled with that officer's current details.
  function openEditModal(user) {
    setEditUser(user);
    setEditForm({
      fullName: user.fullName || "",
      department: user.department || "",
      role: user.role || "",
      phoneNumber: user.phoneNumber || "",
      address: user.address || "",
      emergencyContactName: user.emergencyContactName || "",
      emergencyContactPhone: user.emergencyContactPhone || "",
    });
    setEditError("");
  }

  function updateEditField(key, value) {
    setEditForm((f) => ({ ...f, [key]: value }));
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editUser) return;
    setEditError("");

    const required = ["fullName", "department", "role", "phoneNumber", "address"];
    if (required.some((key) => !editForm[key])) {
      setEditError(t("personnel.errEditAllFields"));
      return;
    }
    if (editForm.phoneNumber.length !== 10) {
      setEditError(t("personnel.errEditPhoneLength"));
      return;
    }

    setEditSubmitting(true);
    try {
      const updated = await updateUser(editUser.id, editForm);
      setUsers((prev) =>
        prev.map((u) => (u.id === editUser.id ? { ...u, ...editForm, ...updated } : u))
      );
      setEditUser(null);
    } catch (err) {
      setEditError(err.message || t("personnel.errUpdateFailed"));
    } finally {
      setEditSubmitting(false);
    }
  }

  const filteredUsers = users.filter((u) => {
    const term = search.toLowerCase();
    return (
      u.fullName?.toLowerCase().includes(term) ||
      u.rankAndNumber?.toLowerCase().includes(term) ||
      u.department?.toLowerCase().includes(term)
    );
  });

  const columns = [
    { key: "fullName", label: t("personnel.colOfficerName") },
    { key: "rankAndNumber", label: t("personnel.colRankNo") },
    { key: "role", label: t("personnel.colSystemRoles"), render: (r) => <span style={{ textTransform: "capitalize" }}>{r.role?.replace("_", " ")}</span> },
    { key: "department", label: t("personnel.colDepartment") },
    { key: "status", label: t("common.status"), render: (r) => <Badge status={r.status} /> },
    {
      key: "actions",
      label: t("common.actions"),
      render: (r) => (
        <div className="personnel-row-actions">
          <Button variant="ghost" onClick={() => setViewUser(r)}>{t("personnel.viewMore")}</Button>
          <Button variant="ghost" onClick={() => openEditModal(r)}>{t("personnel.edit")}</Button>
          <Button variant="ghost" onClick={() => setResetModalUser(r)}>{t("personnel.resetPassword")}</Button>
          <Button variant={r.status === "active" ? "danger" : "outline"} onClick={() => handleToggleStatus(r)}>
            {r.status === "active" ? t("personnel.disable") : t("personnel.enable")}
          </Button>
        </div>
      ),
    },
  ];

  if (loading) return <Loader label={t("personnel.loading")} />;

  if (view === "register") {
    return (
      <div>
        <div className="personnel-header">
          <h1>{t("personnel.registerTitle")}</h1>
        </div>

        {createdAccount ? (
          <Card variant="panel">
            <h3 style={{ marginBottom: 12 }}>{t("personnel.accountCreated")}</h3>
            <p>
              {t("personnel.accountCreatedText1")} <strong>{createdAccount.fullName}</strong> {t("personnel.accountCreatedText2")}
            </p>
            <p style={{ marginTop: 12 }}>
              <strong>{t("personnel.username")}</strong> {createdAccount.rankAndNumber}
              <br />
              <strong>{t("personnel.password")}</strong> {createdAccount.password}
            </p>
            <div style={{ marginTop: 24 }}>
              <Button variant="primary" onClick={() => { setCreatedAccount(null); setView("list"); }}>
                {t("personnel.done")}
              </Button>
            </div>
          </Card>
        ) : (
          <Card variant="panel">
            <form onSubmit={handleSubmit}>
              <div className="personnel-form-grid">
                <InputField label={t("personnel.fullName")} required value={form.fullName} onChange={(e) => updateField("fullName", sanitizeName(e.target.value))} />
                <InputField label={t("personnel.rankAndNumber")} required value={form.rankAndNumber} onChange={(e) => updateField("rankAndNumber", e.target.value)}
                  placeholder={t("personnel.rankAndNumberPlaceholder")} />
                <InputField label={t("personnel.departmentDivision")} type="select" required value={form.department}
                  onChange={(e) => updateField("department", e.target.value)} options={DEPARTMENT_OPTIONS} />
                <InputField label={t("personnel.role")} type="select" required value={form.role}
                  onChange={(e) => updateField("role", e.target.value)} options={ROLE_OPTIONS} />
                <InputField label={t("personnel.phoneNumber")} required value={form.phoneNumber}
                  onChange={(e) => updateField("phoneNumber", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder={t("personnel.phonePlaceholder")} />
                <InputField label={t("personnel.address")} required value={form.address}
                  onChange={(e) => updateField("address", e.target.value)} />
                <InputField label={t("personnel.emergencyContactName")} value={form.emergencyContactName}
                  onChange={(e) => updateField("emergencyContactName", sanitizeName(e.target.value))} />
                <InputField label={t("personnel.emergencyContactPhone")} value={form.emergencyContactPhone}
                  onChange={(e) => updateField("emergencyContactPhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder={t("personnel.phonePlaceholder")} />
              </div>

              <InputField label={t("personnel.setPassword")} type="password" required value={form.password}
                onChange={(e) => updateField("password", e.target.value)}
                helperText={t("personnel.setPasswordHelper")} />

              {formError && <p style={{ color: "var(--color-danger)", marginBottom: 16 }}>{formError}</p>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                <Button variant="ghost" type="button" onClick={() => setView("list")}>{t("personnel.cancel")}</Button>
                <Button variant="primary" type="submit" disabled={submitting}>
                  {submitting ? t("personnel.saving") : t("personnel.saveOfficerDetails")}
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="personnel-header">
        <div>
          <h1>{t("personnel.pageTitle")}</h1>
        </div>
        <Button variant="primary" onClick={() => setView("register")}>{t("personnel.addNewUser")}</Button>
      </div>
      <p className="personnel-subtitle">{t("personnel.subtitle")}</p>

      <div className="stat-grid">
        <StatCard label={t("personnel.totalPersonnel")} value={stats?.totalPersonnel} />
        <StatCard label={t("personnel.activeSystemUsers")} value={stats?.activeSystemUsers} />
        <StatCard label={t("personnel.pendingApproves")} value={stats?.pendingApproves} />
        <StatCard label={t("personnel.disabledAccounts")} value={stats?.disabledAccounts} />
      </div>

      <input
        className="personnel-search"
        placeholder={t("personnel.searchPlaceholder")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16, width: "100%", boxSizing: "border-box" }}
      />

      <Card variant="panel">
        <Table columns={columns} data={filteredUsers} emptyMessage={t("personnel.noPersonnelFound")} />
      </Card>

      <Modal
        open={Boolean(resetModalUser)}
        onClose={() => setResetModalUser(null)}
        title={resetModalUser ? `${t("personnel.resetPasswordFor")} ${resetModalUser.fullName}` : ""}
        footer={
          <Button variant="primary" onClick={handleResetPassword} disabled={resetting || newPassword.length < 6}>
            {resetting ? t("personnel.saving") : t("personnel.setNewPassword")}
          </Button>
        }
      >
        <InputField
          label={t("personnel.newPassword")}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          helperText={t("personnel.newPasswordHelper")}
        />
      </Modal>

      <Modal
        open={Boolean(viewUser)}
        onClose={() => setViewUser(null)}
        title={viewUser ? viewUser.fullName : ""}
      >
        {viewUser && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("personnel.rankNumber")}</p>
              <p>{viewUser.rankAndNumber}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("personnel.role")}</p>
              <p style={{ textTransform: "capitalize" }}>{viewUser.role?.replace("_", " ")}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("personnel.colDepartment")}</p>
              <p>{viewUser.department}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("common.status")}</p>
              <Badge status={viewUser.status} />
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("personnel.phoneNumber")}</p>
              <p>{viewUser.phoneNumber || "—"}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("personnel.address")}</p>
              <p>{viewUser.address || "—"}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("personnel.emergencyContact")}</p>
              <p>
                {viewUser.emergencyContactName || viewUser.emergencyContactPhone
                  ? [viewUser.emergencyContactName, viewUser.emergencyContactPhone].filter(Boolean).join(" — ")
                  : "—"}
              </p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(editUser)}
        onClose={() => setEditUser(null)}
        title={editUser ? `${t("personnel.edit")} ${editUser.fullName}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditUser(null)}>{t("personnel.cancel")}</Button>
            <Button variant="primary" onClick={handleEditSubmit} disabled={editSubmitting}>
              {editSubmitting ? t("personnel.saving") : t("personnel.saveChanges")}
            </Button>
          </>
        }
      >
        {editUser && (
          <form onSubmit={handleEditSubmit}>
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("personnel.rankNumber").toUpperCase()}</p>
              <p>{editUser.rankAndNumber} <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t("personnel.loginUsernameNote")}</span></p>
            </div>
            <InputField
              label={t("personnel.fullName")}
              required
              value={editForm.fullName}
              onChange={(e) => updateEditField("fullName", sanitizeName(e.target.value))}
            />
            <InputField
              label={t("personnel.departmentDivision")}
              type="select"
              required
              value={editForm.department}
              onChange={(e) => updateEditField("department", e.target.value)}
              options={DEPARTMENT_OPTIONS}
            />
            <InputField
              label={t("personnel.role")}
              type="select"
              required
              value={editForm.role}
              onChange={(e) => updateEditField("role", e.target.value)}
              options={ROLE_OPTIONS}
            />
            <InputField
              label={t("personnel.phoneNumber")}
              required
              value={editForm.phoneNumber}
              onChange={(e) => updateEditField("phoneNumber", e.target.value.replace(/\D/g, "").slice(0, 10))}
            />
            <InputField
              label={t("personnel.address")}
              required
              value={editForm.address}
              onChange={(e) => updateEditField("address", e.target.value)}
            />
            <InputField
              label={t("personnel.emergencyContactName")}
              value={editForm.emergencyContactName}
              onChange={(e) => updateEditField("emergencyContactName", sanitizeName(e.target.value))}
            />
            <InputField
              label={t("personnel.emergencyContactPhone")}
              value={editForm.emergencyContactPhone}
              onChange={(e) => updateEditField("emergencyContactPhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder={t("personnel.phonePlaceholder")}
            />

            {editError && <p style={{ color: "var(--color-danger)" }}>{editError}</p>}
          </form>
        )}
      </Modal>
    </div>
  );
}
