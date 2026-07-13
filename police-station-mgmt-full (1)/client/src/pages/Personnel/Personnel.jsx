import { useEffect, useState } from "react";
import { Button, InputField, Card, StatCard, Table, Badge, Loader, Modal } from "../../components";
import {
  listUsers,
  getPersonnelStats,
  createUser,
  updateUser,
  updateUserStatus,
  resetPassword,
} from "../../services/users";
import "./Personnel.css";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "oic", label: "OIC" },
  { value: "duty_officer", label: "Duty Officer" },
  { value: "inventory_officer", label: "Inventory Officer" },
  { value: "officer", label: "Officer" },
];

const DEPARTMENT_OPTIONS = [
  { value: "Administration", label: "Administration" },
  { value: "Command", label: "Command" },
  { value: "Traffic Control", label: "Traffic Control" },
  { value: "Crime", label: "Crime" },
  { value: "Stores", label: "Stores" },
];

const EMPTY_FORM = {
  fullName: "",
  rankAndNumber: "",
  department: "",
  role: "",
  phoneNumber: "",
  address: "",
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
};

export function PersonnelPage() {
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
      setFormError("Please complete all fields, including a password.");
      return;
    }
    if (form.password.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }
    if (form.phoneNumber.length !== 10) {
      setFormError("Phone number must be exactly 10 digits.");
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
      setFormError(err.message || "Could not create personnel account");
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
      setEditError("Please complete all fields.");
      return;
    }
    if (editForm.phoneNumber.length !== 10) {
      setEditError("Phone number must be exactly 10 digits.");
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
      setEditError(err.message || "Could not update personnel details");
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
    { key: "fullName", label: "Officer Name" },
    { key: "rankAndNumber", label: "Rank & No" },
    { key: "role", label: "System Roles", render: (r) => <span style={{ textTransform: "capitalize" }}>{r.role?.replace("_", " ")}</span> },
    { key: "department", label: "Department" },
    { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
    {
      key: "actions",
      label: "Actions",
      render: (r) => (
        <div className="personnel-row-actions">
          <Button variant="ghost" onClick={() => setViewUser(r)}>View More</Button>
          <Button variant="ghost" onClick={() => openEditModal(r)}>Edit</Button>
          <Button variant="ghost" onClick={() => setResetModalUser(r)}>Reset Password</Button>
          <Button variant={r.status === "active" ? "danger" : "outline"} onClick={() => handleToggleStatus(r)}>
            {r.status === "active" ? "Disable" : "Enable"}
          </Button>
        </div>
      ),
    },
  ];

  if (loading) return <Loader label="Loading personnel…" />;

  if (view === "register") {
    return (
      <div>
        <div className="personnel-header">
          <h1>Register new Personnel</h1>
        </div>

        {createdAccount ? (
          <Card variant="panel">
            <h3 style={{ marginBottom: 12 }}>Account created</h3>
            <p>
              Give these credentials to <strong>{createdAccount.fullName}</strong> — this is the only time the
              password is shown. Use "Reset Password" from the list later if it needs to change.
            </p>
            <p style={{ marginTop: 12 }}>
              <strong>Username:</strong> {createdAccount.rankAndNumber}
              <br />
              <strong>Password:</strong> {createdAccount.password}
            </p>
            <div style={{ marginTop: 24 }}>
              <Button variant="primary" onClick={() => { setCreatedAccount(null); setView("list"); }}>
                Done
              </Button>
            </div>
          </Card>
        ) : (
          <Card variant="panel">
            <form onSubmit={handleSubmit}>
              <div className="personnel-form-grid">
                <InputField label="Full Name" required value={form.fullName} onChange={(e) => updateField("fullName", e.target.value)} />
                <InputField label="Rank and Number" required value={form.rankAndNumber} onChange={(e) => updateField("rankAndNumber", e.target.value)}
                  placeholder="This becomes their login username" />
                <InputField label="Department/Division" type="select" required value={form.department}
                  onChange={(e) => updateField("department", e.target.value)} options={DEPARTMENT_OPTIONS} />
                <InputField label="Role" type="select" required value={form.role}
                  onChange={(e) => updateField("role", e.target.value)} options={ROLE_OPTIONS} />
                <InputField label="Phone Number" required value={form.phoneNumber}
                  onChange={(e) => updateField("phoneNumber", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="e.g. 0771234567" />
                <InputField label="Address" required value={form.address}
                  onChange={(e) => updateField("address", e.target.value)} />
              </div>

              <InputField label="Set Password" type="password" required value={form.password}
                onChange={(e) => updateField("password", e.target.value)}
                helperText="Minimum 6 characters. Share this with the officer directly — there is no self-service signup." />

              {formError && <p style={{ color: "var(--color-danger)", marginBottom: 16 }}>{formError}</p>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                <Button variant="ghost" type="button" onClick={() => setView("list")}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={submitting}>
                  {submitting ? "Saving…" : "Save Officer Details"}
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
          <h1>Personnel & User Managment</h1>
        </div>
        <Button variant="primary" onClick={() => setView("register")}>ADD NEW USER</Button>
      </div>
      <p className="personnel-subtitle">Manage Station Officer access roles, Department Assignment, and System Status</p>

      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Personnel" value={stats?.totalPersonnel} />
        <StatCard label="Active System Users" value={stats?.activeSystemUsers} />
        <StatCard label="Pending Approves" value={stats?.pendingApproves} />
        <StatCard label="Disabled Accounts" value={stats?.disabledAccounts} />
      </div>

      <input
        className="personnel-search"
        placeholder="Search by name, NIC, or rank no"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16, width: "100%", boxSizing: "border-box" }}
      />

      <Card variant="panel">
        <Table columns={columns} data={filteredUsers} emptyMessage="No personnel found" />
      </Card>

      <Modal
        open={Boolean(resetModalUser)}
        onClose={() => setResetModalUser(null)}
        title={resetModalUser ? `Reset password for ${resetModalUser.fullName}` : ""}
        footer={
          <Button variant="primary" onClick={handleResetPassword} disabled={resetting || newPassword.length < 6}>
            {resetting ? "Saving…" : "Set New Password"}
          </Button>
        }
      >
        <InputField
          label="New Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          helperText="Minimum 6 characters"
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
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>Rank & Number</p>
              <p>{viewUser.rankAndNumber}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>Role</p>
              <p style={{ textTransform: "capitalize" }}>{viewUser.role?.replace("_", " ")}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>Department</p>
              <p>{viewUser.department}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>Status</p>
              <Badge status={viewUser.status} />
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>Phone Number</p>
              <p>{viewUser.phoneNumber || "—"}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>Address</p>
              <p>{viewUser.address || "—"}</p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(editUser)}
        onClose={() => setEditUser(null)}
        title={editUser ? `Edit ${editUser.fullName}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleEditSubmit} disabled={editSubmitting}>
              {editSubmitting ? "Saving…" : "Save Changes"}
            </Button>
          </>
        }
      >
        {editUser && (
          <form onSubmit={handleEditSubmit}>
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>RANK AND NUMBER</p>
              <p>{editUser.rankAndNumber} <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>(login username — cannot be changed here)</span></p>
            </div>
            <InputField
              label="Full Name"
              required
              value={editForm.fullName}
              onChange={(e) => updateEditField("fullName", e.target.value)}
            />
            <InputField
              label="Department/Division"
              type="select"
              required
              value={editForm.department}
              onChange={(e) => updateEditField("department", e.target.value)}
              options={DEPARTMENT_OPTIONS}
            />
            <InputField
              label="Role"
              type="select"
              required
              value={editForm.role}
              onChange={(e) => updateEditField("role", e.target.value)}
              options={ROLE_OPTIONS}
            />
            <InputField
              label="Phone Number"
              required
              value={editForm.phoneNumber}
              onChange={(e) => updateEditField("phoneNumber", e.target.value.replace(/\D/g, "").slice(0, 10))}
            />
            <InputField
              label="Address"
              required
              value={editForm.address}
              onChange={(e) => updateEditField("address", e.target.value)}
            />

            {editError && <p style={{ color: "var(--color-danger)" }}>{editError}</p>}
          </form>
        )}
      </Modal>
    </div>
  );
}
