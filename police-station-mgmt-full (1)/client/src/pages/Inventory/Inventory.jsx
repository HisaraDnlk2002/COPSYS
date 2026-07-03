import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { Button, InputField, Card, StatCard, Table, Loader, Modal } from "../../components";
import {
  getInventoryStats,
  getInventoryItems,
  getIssueTransactions,
  getReturnTransactions,
  getDamagedRecords,
  addInventoryItem,
  issueItem,
  returnItem as returnItemRequest,
} from "../../services/inventory";
import "./Inventory.css";

const TABS = [
  { key: "weapons", label: "Weapon Details" },
  { key: "issue", label: "Issue records" },
  { key: "return", label: "Return Records" },
  { key: "damaged", label: "Damaged Records" },
];

const EMPTY_ISSUE_FORM = { officerId: "", weaponSerialId: "", quantity: "", deploymentDate: "" };
const EMPTY_RETURN_FORM = { officerId: "", weaponSerialId: "", returnDate: "", condition: "" };
const EMPTY_ADD_FORM = { officerId: "", weaponSerialId: "", quantity: "", weaponType: "" };

export function InventoryPage() {
  const { user } = useAuth();
  const canManage = user?.role === "inventory_officer";

  const [activeTab, setActiveTab] = useState("weapons");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [issueTx, setIssueTx] = useState([]);
  const [returnTx, setReturnTx] = useState([]);
  const [damagedTx, setDamagedTx] = useState([]);

  const [openModal, setOpenModal] = useState(null); // null | "issue" | "return" | "add"
  const [issueForm, setIssueForm] = useState(EMPTY_ISSUE_FORM);
  const [returnForm, setReturnForm] = useState(EMPTY_RETURN_FORM);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getInventoryStats(),
      getInventoryItems(),
      getIssueTransactions(),
      getReturnTransactions(),
      getDamagedRecords(),
    ])
      .then(([statsRes, itemsRes, issueRes, returnRes, damagedRes]) => {
        if (cancelled) return;
        setStats(statsRes);
        setItems(itemsRes);
        setIssueTx(issueRes);
        setReturnTx(returnRes);
        setDamagedTx(damagedRes);
      })
      .catch((err) => console.error("Failed to load inventory:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function closeModal() {
    setOpenModal(null);
    setIssueForm(EMPTY_ISSUE_FORM);
    setReturnForm(EMPTY_RETURN_FORM);
    setAddForm(EMPTY_ADD_FORM);
  }

  async function handleIssueSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const tx = await issueItem(issueForm.weaponSerialId, {
        officerName: issueForm.officerId,
        dutyType: "Patrol",
        dateTime: issueForm.deploymentDate,
        quantity: issueForm.quantity,
      });
      setIssueTx((prev) => [tx, ...prev]);
      closeModal();
    } catch (err) {
      console.error("Issue failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReturnSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const tx = await returnItemRequest(returnForm.weaponSerialId, {
        officerName: returnForm.officerId,
        dutyType: "Patrol",
        dateTime: returnForm.returnDate,
        condition: returnForm.condition,
      });
      setReturnTx((prev) => [tx, ...prev]);
      closeModal();
    } catch (err) {
      console.error("Return failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const item = await addInventoryItem({
        itemId: addForm.weaponSerialId,
        itemName: addForm.weaponType,
        category: "Firearms",
        quantity: Number(addForm.quantity) || 0,
      });
      setItems((prev) => [item, ...prev]);
      closeModal();
    } catch (err) {
      console.error("Add item failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loader label="Loading inventory…" />;

  const ledgerColumns = [
    { key: "itemId", label: "Item ID" },
    { key: "itemName", label: "Item Name" },
    { key: "category", label: "Category" },
    { key: "quantity", label: "Quantity" },
    { key: "status", label: "Status" },
  ];

  const issueColumns = [
    { key: "itemId", label: "Item ID" },
    { key: "officerName", label: "Officer Name" },
    { key: "dutyType", label: "Duty Type" },
    { key: "dateTime", label: "Date & Time" },
    { key: "status", label: "Status" },
  ];

  const returnColumns = [
    { key: "itemId", label: "Item ID" },
    { key: "officerName", label: "Officer Name" },
    { key: "dutyType", label: "Duty Type" },
    { key: "dateTime", label: "Date & Time" },
    { key: "condition", label: "Condition" },
    { key: "remarks", label: "Remarks" },
  ];

  return (
    <div>
      <div className="inventory-header">
        <h1>Inventory Dashboard</h1>
        {canManage && (
          <div className="inventory-header-actions">
            <Button variant="outline" onClick={() => setOpenModal("issue")}>Issue Item</Button>
            <Button variant="outline" onClick={() => setOpenModal("return")}>Return Item</Button>
            <Button variant="primary" onClick={() => setOpenModal("add")}>Add New Item</Button>
          </div>
        )}
      </div>
      <p className="inventory-subtitle">Station Asset Registry: {stats?.stationLabel}</p>

      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Assets" value={stats?.totalAssets} caption="All categories combined" />
        <StatCard label="Issued Items" value={stats?.issuedItems} caption="Currently in operational use" />
        <StatCard label="Available Stock" value={stats?.availableStock} caption="Ready for Deployment" />
        <StatCard label="Damaged/Repairs" value={stats?.damagedRepairs} caption="Requires immediate attention" />
      </div>

      <div className="inventory-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`inventory-tab${activeTab === tab.key ? " active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card variant="panel">
        {activeTab === "weapons" && (
          <>
            <p className="inventory-ledger-title">Equipment Inventory Ledger</p>
            <p className="inventory-ledger-subtitle">Official registry of firearms, communications, and safety gear</p>
            <Table columns={ledgerColumns} data={items} emptyMessage="No inventory items yet" />
            <div className="inventory-footer-row">
              <span>Showing {items.length} of {stats?.totalAssets ?? items.length} unique items registered.</span>
            </div>
          </>
        )}

        {activeTab === "issue" && (
          <>
            <p className="inventory-ledger-title">Equipment Issuing Log</p>
            <p className="inventory-ledger-subtitle">Focused on what is currently out in the field</p>
            <Table columns={issueColumns} data={issueTx} emptyMessage="No items currently issued" />
          </>
        )}

        {activeTab === "return" && (
          <>
            <p className="inventory-ledger-title">Equipment Returned Log</p>
            <p className="inventory-ledger-subtitle">Focused on what has come back from the field</p>
            <Table columns={returnColumns} data={returnTx} emptyMessage="No returns recorded yet" />
          </>
        )}

        {activeTab === "damaged" && (
          <>
            <p className="inventory-ledger-title">Damaged / Repair Records</p>
            <p className="inventory-ledger-subtitle">Items returned in faulty condition, requiring attention</p>
            <Table columns={returnColumns} data={damagedTx} emptyMessage="No damaged items reported" />
          </>
        )}
      </Card>

      <Modal
        open={openModal === "issue"}
        onClose={closeModal}
        title="Issue Item Form"
        footer={
          <Button variant="primary" fullWidth onClick={handleIssueSubmit} disabled={submitting}>
            {submitting ? "Processing…" : "Confirm Issue Transaction"}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          Record weapon issuing to the officers
        </p>
        <div className="modal-form-grid">
          <InputField label="Officer ID" value={issueForm.officerId} onChange={(e) => setIssueForm((f) => ({ ...f, officerId: e.target.value }))} />
          <InputField label="Weapon Serial ID" value={issueForm.weaponSerialId} onChange={(e) => setIssueForm((f) => ({ ...f, weaponSerialId: e.target.value }))} />
          <InputField label="Quantity to Issue" value={issueForm.quantity} onChange={(e) => setIssueForm((f) => ({ ...f, quantity: e.target.value }))} />
          <InputField label="Deployment Date" type="date" value={issueForm.deploymentDate} onChange={(e) => setIssueForm((f) => ({ ...f, deploymentDate: e.target.value }))} />
        </div>
      </Modal>

      <Modal
        open={openModal === "return"}
        onClose={closeModal}
        title="Return Item Form"
        footer={
          <Button variant="primary" fullWidth onClick={handleReturnSubmit} disabled={submitting}>
            {submitting ? "Processing…" : "Process Return Audit"}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          Record weapon returning from the officers
        </p>
        <div className="modal-form-grid">
          <InputField label="Officer ID" value={returnForm.officerId} onChange={(e) => setReturnForm((f) => ({ ...f, officerId: e.target.value }))} />
          <InputField label="Weapon Serial ID" value={returnForm.weaponSerialId} onChange={(e) => setReturnForm((f) => ({ ...f, weaponSerialId: e.target.value }))} />
          <InputField label="Return Date" type="date" value={returnForm.returnDate} onChange={(e) => setReturnForm((f) => ({ ...f, returnDate: e.target.value }))} />
          <InputField label="Weapon Condition" value={returnForm.condition} onChange={(e) => setReturnForm((f) => ({ ...f, condition: e.target.value }))} />
        </div>
      </Modal>

      <Modal
        open={openModal === "add"}
        onClose={closeModal}
        title="Add New Item Form"
        footer={
          <Button variant="primary" fullWidth onClick={handleAddSubmit} disabled={submitting}>
            {submitting ? "Processing…" : "Confirm Add"}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          Record a new item into the inventory ledger
        </p>
        <div className="modal-form-grid">
          <InputField label="Officer ID" value={addForm.officerId} onChange={(e) => setAddForm((f) => ({ ...f, officerId: e.target.value }))} />
          <InputField label="Weapon Serial ID" value={addForm.weaponSerialId} onChange={(e) => setAddForm((f) => ({ ...f, weaponSerialId: e.target.value }))} />
          <InputField label="Quantity to Add" value={addForm.quantity} onChange={(e) => setAddForm((f) => ({ ...f, quantity: e.target.value }))} />
          <InputField label="Weapon Type" value={addForm.weaponType} onChange={(e) => setAddForm((f) => ({ ...f, weaponType: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}
