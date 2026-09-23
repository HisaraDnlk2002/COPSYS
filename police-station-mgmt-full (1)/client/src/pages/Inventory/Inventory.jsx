import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, InputField, Card, StatCard, Table, Loader, Modal, SearchableSelect, Badge, Pagination } from "../../components";
import {
  getInventoryStats,
  getInventoryItems,
  getIssueTransactions,
  getReturnTransactions,
  getDamagedRecords,
  addInventoryItem,
  issueItem,
  returnItem as returnItemRequest,
  reportMissing,
  restockItem,
} from "../../services/inventory";
import { getMaintenanceRecords, updateMaintenanceRecord, returnMaintenanceToStock } from "../../services/maintenance";
import { getInspections, createInspection } from "../../services/inspections";
import { searchOfficers } from "../../services/officers";
import { formatDate } from "../../utils/formatDate";
import {
  WEAPON_CATALOG,
  AMMUNITION_CATEGORY,
  STORAGE_LOCATIONS,
  typesForCategory,
  calibersForType,
  accessoriesForType,
} from "../../config/weaponCatalog";

// Tick-box list used for accessories on the Issue and Return forms —
// more than one can apply, so a single-choice select doesn't fit.
function CheckboxGroup({ label, options, selected, onChange, emptyText }) {
  function toggle(option) {
    onChange(selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option]);
  }
  return (
    <div className="field">
      <span className="field-label">{label.toUpperCase()}</span>
      {options.length === 0 ? (
        <p className="inventory-checkbox-empty">{emptyText}</p>
      ) : (
        <div className="inventory-checkbox-group">
          {options.map((option) => (
            <label key={option} className={`inventory-checkbox${selected.includes(option) ? " checked" : ""}`}>
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
import { MaintenancePartsEditor } from "./MaintenancePartsEditor";
import { EMPTY_PART, partsForSubmit, formatLkr } from "./maintenanceParts";
import "./Inventory.css";

// How soon before nextInspectionDate a weapon counts as "due soon"
// rather than just "on schedule" — purely a display threshold, doesn't
// affect anything server-side.
const INSPECTION_DUE_SOON_DAYS = 14;

// dateTime/generatedAt/etc. come back from the API as full ISO strings
// ("2026-09-10T14:32:46.000Z") — this renders that as "10/09/2026 14:32"
// (military clock, see formatDate.js) rather than the raw ISO string
// with its seconds/milliseconds/Z suffix.
function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  // Records from before issue times were stamped automatically only had a
  // date (stored as exactly midnight UTC) — show just the date for those
  // rather than an invented time.
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return formatDate(value);
  }
  // A real moment: show it in the viewer's local time (Sri Lanka, UTC+5:30),
  // not the raw UTC digits.
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()} ${hours}:${minutes}`;
}

// Slices a filtered list down to one page and clamps the requested page
// number to whatever's actually valid for that list's current length —
// same "falls back to the last valid page" convention as
// Personnel/AuditLog/Complaints, just reusable here across this page's
// several tables instead of one.
function paginate(list, pageNum) {
  const totalPages = Math.max(Math.ceil(list.length / PAGE_SIZE), 1);
  const safePage = Math.min(pageNum, totalPages);
  return { items: list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), totalPages, safePage };
}

// Weapon ID and Item ID are exactly 5 digits. toFiveDigits drops
// anything that isn't a digit and stops at 5 as you type.
const FIVE_DIGITS = /^\d{5}$/;
function toFiveDigits(value) {
  return value.replace(/\D/g, "").slice(0, 5);
}

// Keeps a typed round count within 0..max (whole numbers only), so the
// form can't hold more rounds than were issued / are in stock. Empty
// stays empty so the field can be cleared while typing.
function capRounds(value, max) {
  if (value === "") return "";
  const n = Math.max(0, Math.floor(Number(value)));
  if (!Number.isFinite(n)) return "";
  return String(Number.isFinite(max) ? Math.min(n, max) : n);
}

// Same lookup as the shared officer search, but labeled by Rank &
// Number instead of phone number — that's the officer's actual ID
// elsewhere in this app (login username, Personnel table), so it's the
// more useful thing to see and log here regardless of whether you
// searched by name or by rank number (the server matches either).
async function searchOfficersByRank(query) {
  const officers = await searchOfficers(query);
  return officers.map((o) => ({ ...o, label: `${o.fullName} — ${o.rankAndNumber}` }));
}

// officer/item start out unselected ({ value, label } from SearchableSelect,
// not free text) — see handleIssueSubmit/handleReturnSubmit for why that
// matters: the backend needs real ids, not whatever was typed.
const EMPTY_ISSUE_FORM = {
  officer: null,
  item: null,
  expectedReturnDate: "",
  ammoItem: null,
  ammoIssued: "",
  accessories: [],
};
const EMPTY_RETURN_FORM = {
  officer: null,
  item: null,
  returnDate: "",
  condition: "",
  faultReason: "",
  ammoIssued: "",
  ammoReturned: "",
  ammoDeclaredUsed: "",
  accessoriesComplete: "",
  missingAccessories: [],
  accessoriesRemarks: "",
};
const EMPTY_ADD_FORM = {
  weaponSerialId: "",
  serialNumber: "",
  quantity: "",
  weaponType: "",
  category: "",
  caliber: "",
  storageLocation: "",
  condition: "good",
  lastInspectionDate: "",
  lowStockThreshold: "",
};
const EMPTY_RESTOCK_FORM = { quantity: "", remarks: "" };

// Rendering a whole tab's table in one go meant endless scrolling once a
// station has more than a handful of records — page through the
// filtered results instead, same pattern as Personnel/AuditLog/Complaints.
const PAGE_SIZE = 15;

export function InventoryPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const canManage = user?.role === "inventory_officer";

  // No standalone "Damaged" tab — damaged-type transactions still get
  // fetched (damagedTx feeds the combined Audit Ledger tab below) but a
  // dedicated tab for them was redundant with Audit Ledger's Type filter
  // and the Maintenance tab, which is where a damaged weapon's actual
  // repair workflow lives now.
  const TABS = [
    { key: "weapons", label: t("inventory.tabWeapons") },
    { key: "ammunition", label: t("inventory.tabAmmunition") },
    { key: "issue", label: t("inventory.tabIssue") },
    { key: "return", label: t("inventory.tabReturn") },
    { key: "ledger", label: t("inventory.tabLedger") },
    { key: "maintenance", label: t("inventory.tabMaintenance") },
    { key: "inspections", label: t("inventory.tabInspections") },
  ];

  const [activeTab, setActiveTab] = useState("weapons");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [issueTx, setIssueTx] = useState([]);
  const [returnTx, setReturnTx] = useState([]);
  const [damagedTx, setDamagedTx] = useState([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState([]);
  const [inspectionRecords, setInspectionRecords] = useState([]);

  const [openModal, setOpenModal] = useState(null); // null | "issue" | "return" | "add"
  const [issueForm, setIssueForm] = useState(EMPTY_ISSUE_FORM);
  const [returnForm, setReturnForm] = useState(EMPTY_RETURN_FORM);
  // The issue record the Return form's quantity/ammoIssued were
  // pre-filled from (see findOpenIssueRecord) — kept only to show the
  // "Issued on … for …" caption under the weapon picker, not submitted
  // with the return itself.
  const [returnSourceIssue, setReturnSourceIssue] = useState(null);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  // The ammunition (or other stock) line open in the Restock modal, or null.
  const [restockingItem, setRestockingItem] = useState(null);
  const [restockForm, setRestockForm] = useState(EMPTY_RESTOCK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");

  // GlobalSearch (topbar) lands here with { state: { searchTerm } } so an
  // Inventory hit jumps straight to a pre-filtered list.
  const [search, setSearch] = useState(location.state?.searchTerm || "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all"); // "all" | a WEAPON_CATALOG category — only used on the "weapons" tab
  const [typeFilter, setTypeFilter] = useState("all"); // "all" | "issue" | "return" | "damaged" — only used on the "ledger" tab
  // Only one tab's table is ever visible at once, so one page number
  // covers all of them — reset to 1 on every tab switch (see the tab
  // button's onClick below) so a stale page from a longer table doesn't
  // carry over into a shorter one. inspectionHistoryPage is separate
  // because the "inspections" tab is the one place with two tables at
  // once (due-for-inspection + history) sharing a single tab.
  const [page, setPage] = useState(1);
  const [inspectionHistoryPage, setInspectionHistoryPage] = useState(1);

  // The maintenance record currently open in the manage modal, or null.
  // Its own fields double as the form state (editing this object
  // directly, then diffing what changed into the PATCH payload) since
  // the modal's available actions depend entirely on record.status.
  const [managingRecord, setManagingRecord] = useState(null);
  const [maintenanceForm, setMaintenanceForm] = useState(null);
  const [maintenanceSubmitting, setMaintenanceSubmitting] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState("");

  // The Inventory item currently open in the inspect modal, or null.
  const [inspectingItem, setInspectingItem] = useState(null);
  const [inspectionForm, setInspectionForm] = useState(null);
  const [inspectionSubmitting, setInspectionSubmitting] = useState(false);
  const [inspectionError, setInspectionError] = useState("");

  // The Inventory item currently open in the "Report Missing" modal, or null.
  const [reportingMissingItem, setReportingMissingItem] = useState(null);
  const [missingRemarks, setMissingRemarks] = useState("");
  const [missingSubmitting, setMissingSubmitting] = useState(false);
  const [missingError, setMissingError] = useState("");

  function loadAll() {
    return Promise.all([
      getInventoryStats(),
      getInventoryItems(),
      getIssueTransactions(),
      getReturnTransactions(),
      getDamagedRecords(),
      getMaintenanceRecords(),
      getInspections(),
    ]).then(([statsRes, itemsRes, issueRes, returnRes, damagedRes, maintenanceRes, inspectionRes]) => {
      setStats(statsRes);
      setItems(itemsRes);
      setIssueTx(issueRes);
      setReturnTx(returnRes);
      setDamagedTx(damagedRes);
      setMaintenanceRecords(maintenanceRes);
      setInspectionRecords(inspectionRes);
    });
  }

  useEffect(() => {
    let cancelled = false;
    loadAll()
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
    setReturnSourceIssue(null);
    setAddForm(EMPTY_ADD_FORM);
    setRestockingItem(null);
    setRestockForm(EMPTY_RESTOCK_FORM);
    setModalError("");
  }

  // Search-as-you-type over the already-loaded item ledger — there's no
  // server-side item search endpoint, so this filters client-side. Kept
  // async to match SearchableSelect's searchFn contract.
  async function searchIssuableItems(query) {
    const q = query.toLowerCase();
    return items
      .filter(
        (i) =>
          i.quantity > 0 &&
          i.category !== AMMUNITION_CATEGORY && // rounds go out with a weapon via the Ammunition field, never on their own
          !["damaged", "missing", "ready_for_stock"].includes(i.status) && // server blocks these too (see issue()) — filtered here so they're not offered at all
          (i.itemId.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q))
      )
      .map((i) => ({
        value: i.id,
        label: `${i.itemId} — ${i.itemName}`,
        subtitle: `${t("inventory.colQuantity")}: ${i.quantity} · ${i.category}`,
        quantity: i.quantity,
        itemName: i.itemName,
      }));
  }

  // Ammunition stock lines rounds can be drawn from on the Issue form.
  async function searchAmmunitionStock(query) {
    const q = query.toLowerCase();
    return items
      .filter(
        (i) =>
          i.category === AMMUNITION_CATEGORY &&
          i.quantity > 0 &&
          !["damaged", "missing"].includes(i.status) &&
          (i.itemId.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q))
      )
      .map((i) => ({
        value: i.id,
        label: `${i.itemName} — ${i.itemId}`,
        subtitle: `${t("inventory.roundsInStock")}: ${i.quantity}${i.storageLocation ? ` · ${i.storageLocation}` : ""}`,
        quantity: i.quantity,
      }));
  }

  // Which items a given officer is actually still holding — netted from
  // their own issue vs. return/damaged transaction history, not the
  // shared Inventory line's own `status` field. That field only flips
  // to "issued" once the line's whole stock quantity is depleted to 0
  // (see issue() in inventoryController.js) — correct for a
  // one-of-a-kind serialized weapon (quantity 1), but any line stocked
  // above 1 unit stays "available" forever no matter how many units are
  // actually out with officers, so the old status-based check could
  // never find a real, currently-issued unit on one of those lines at
  // all. Netting each officer's own issue quantity against their own
  // return/damaged quantity per item gets the right answer regardless
  // of how the line's stock count reads.
  function getOutstandingItemIds(officerValue) {
    const net = new Map(); // item's Mongo id -> units still outstanding
    for (const tx of issueTx) {
      if (tx.officerId?._id !== officerValue || !tx.itemId?._id) continue;
      net.set(tx.itemId._id, (net.get(tx.itemId._id) || 0) + (tx.quantity || 1));
    }
    for (const tx of [...returnTx, ...damagedTx]) {
      if (tx.officerId?._id !== officerValue || !tx.itemId?._id) continue;
      net.set(tx.itemId._id, (net.get(tx.itemId._id) || 0) - (tx.quantity || 1));
    }
    return new Set([...net.entries()].filter(([, n]) => n > 0).map(([id]) => id));
  }

  // "System loads the officer's currently issued weapon" — the Return
  // modal's item picker is scoped to whichever officer is selected
  // first, rather than searching the whole ledger. Returns nothing
  // until an officer is chosen. minChars={0} on the field itself makes
  // this run (with an empty query) as soon as it's focused, so the
  // officer's issued weapon(s) show immediately rather than requiring
  // the Inventory Officer to type anything.
  async function searchOfficerIssuedItems(query) {
    if (!returnForm.officer) return [];
    const q = query.toLowerCase();
    const outstandingIds = getOutstandingItemIds(returnForm.officer.value);
    return items
      .filter(
        (i) =>
          outstandingIds.has(i.id) &&
          (i.itemId.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q))
      )
      .map((i) => ({
        value: i.id,
        label: `${i.itemId} — ${i.itemName}`,
        subtitle: i.category,
      }));
  }

  // The record the Return form pre-fills from once a weapon is picked —
  // the officer's own most recent "issue" transaction for that exact
  // item. Most recent (not just "any match") because the same serial
  // can have older issue history from before a past return, and that
  // older row isn't the one currently open.
  function findOpenIssueRecord(officerValue, itemValue) {
    if (!officerValue || !itemValue) return null;
    // Populated officerId/itemId only carry the fields listTransactions
    // selected (fullName/rankAndNumber, itemId/itemName/category) plus
    // Mongo's own _id — never the custom `id` the top-level transaction
    // gets from InventoryTransaction's toJSON, since populate() doesn't
    // route a subdocument through its own model's toJSON transform.
    return (
      issueTx
        .filter((tx) => tx.officerId?._id === officerValue && tx.itemId?._id === itemValue)
        .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))[0] || null
    );
  }

  async function handleIssueSubmit(e) {
    e.preventDefault();
    setModalError("");

    if (!issueForm.item || !issueForm.officer) {
      setModalError(t("inventory.errRequiredFields"));
      return;
    }
    const rounds = issueForm.ammoIssued === "" ? 0 : Number(issueForm.ammoIssued);
    if (rounds > 0 && !issueForm.ammoItem) {
      setModalError(t("inventory.errSelectAmmoStock"));
      return;
    }
    if (rounds > 0 && rounds > issueForm.ammoItem.quantity) {
      setModalError(t("inventory.errNotEnoughRounds"));
      return;
    }

    setSubmitting(true);
    try {
      await issueItem(issueForm.item.value, {
        officerId: issueForm.officer.value,
        dutyType: "Patrol",
        quantity: 1, // one weapon per officer
        expectedReturnDate: issueForm.expectedReturnDate || undefined,
        ammoIssued: rounds > 0 ? rounds : undefined,
        ammoItemId: rounds > 0 ? issueForm.ammoItem.value : undefined,
        accessories: issueForm.accessories.length ? issueForm.accessories : undefined,
      });
      await loadAll();
      closeModal();
    } catch (err) {
      setModalError(err.message || t("inventory.errIssueFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReturnSubmit(e) {
    e.preventDefault();
    setModalError("");

    if (!returnForm.item || !returnForm.officer || !returnForm.condition) {
      setModalError(t("inventory.errRequiredFields"));
      return;
    }
    if (returnForm.condition === "Faulty" && !returnForm.faultReason.trim()) {
      setModalError(t("inventory.errFaultReason"));
      return;
    }
    const issuedRounds = returnForm.ammoIssued === "" ? 0 : Number(returnForm.ammoIssued);
    if (issuedRounds > 0 && (returnForm.ammoReturned === "" || returnForm.ammoDeclaredUsed === "")) {
      setModalError(t("inventory.errAmmoCountRequired"));
      return;
    }
    if (returnForm.ammoReturned !== "" && Number(returnForm.ammoReturned) > issuedRounds) {
      setModalError(t("inventory.errAmmoDiscrepancy"));
      return;
    }
    if (returnForm.ammoDeclaredUsed !== "" && Number(returnForm.ammoDeclaredUsed) > issuedRounds) {
      setModalError(t("inventory.errDeclaredExceedsIssued"));
      return;
    }
    if (
      returnForm.accessoriesComplete === "false" &&
      !returnForm.missingAccessories.length &&
      !returnForm.accessoriesRemarks.trim()
    ) {
      setModalError(t("inventory.errAccessoriesRemarks"));
      return;
    }

    setSubmitting(true);
    try {
      await returnItemRequest(returnForm.item.value, {
        officerId: returnForm.officer.value,
        dateTime: returnForm.returnDate,
        condition: returnForm.condition,
        remarks: returnForm.condition === "Faulty" ? returnForm.faultReason.trim() : undefined,
        ammoReturned: returnForm.ammoReturned === "" ? undefined : Number(returnForm.ammoReturned),
        ammoDeclaredUsed: returnForm.ammoDeclaredUsed === "" ? undefined : Number(returnForm.ammoDeclaredUsed),
        accessoriesComplete: returnForm.accessoriesComplete === "" ? undefined : returnForm.accessoriesComplete === "true",
        accessoriesRemarks:
          [returnForm.missingAccessories.join(", "), returnForm.accessoriesRemarks.trim()].filter(Boolean).join(" — ") ||
          undefined,
      });
      await loadAll();
      closeModal();
    } catch (err) {
      setModalError(err.message || t("inventory.errReturnFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    setModalError("");

    const addingAmmunition = addForm.category === AMMUNITION_CATEGORY;
    if (
      !addForm.weaponSerialId ||
      !addForm.weaponType ||
      !addForm.category ||
      !addForm.quantity ||
      (!addingAmmunition && !addForm.serialNumber.trim()) ||
      (addForm.category === "Firearms" && calibersForType(addForm.weaponType).length > 1 && !addForm.caliber)
    ) {
      setModalError(t("inventory.errRequiredFields"));
      return;
    }
    if (!addingAmmunition && (!FIVE_DIGITS.test(addForm.weaponSerialId) || !FIVE_DIGITS.test(addForm.serialNumber))) {
      setModalError(t("inventory.errFiveDigits"));
      return;
    }

    setSubmitting(true);
    try {
      await addInventoryItem({
        itemId: addForm.weaponSerialId,
        itemName: addForm.weaponType,
        category: addForm.category,
        quantity: Number(addForm.quantity) || 0,
        serialNumber: addingAmmunition ? undefined : addForm.serialNumber,
        caliber: addForm.caliber || undefined,
        storageLocation: addForm.storageLocation || undefined,
        condition: addForm.condition,
        lastInspectionDate: addingAmmunition ? undefined : addForm.lastInspectionDate || undefined,
        lowStockThreshold: addingAmmunition && addForm.lowStockThreshold !== "" ? Number(addForm.lowStockThreshold) : undefined,
      });
      await loadAll();
      closeModal();
    } catch (err) {
      setModalError(err.message || t("inventory.errAddFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRestockSubmit(e) {
    e.preventDefault();
    setModalError("");
    const qty = Number(restockForm.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setModalError(t("inventory.errRestockQuantity"));
      return;
    }
    setSubmitting(true);
    try {
      await restockItem(restockingItem.id, { quantity: qty, remarks: restockForm.remarks || undefined });
      await loadAll();
      closeModal();
    } catch (err) {
      setModalError(err.message || t("inventory.errRestockFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function openMaintenance(record) {
    setManagingRecord(record);
    setMaintenanceForm({
      assignedTechnician: record.assignedTechnician || "",
      maintenanceType: record.maintenanceType || "Repair",
      // Inputs hold strings; an open record starts with one blank row
      // ready to fill in.
      parts: record.parts?.length
        ? record.parts.map((p) => ({ name: p.name, quantity: String(p.quantity), unitCost: String(p.unitCost) }))
        : record.status === "completed"
          ? []
          : [{ ...EMPTY_PART }],
      remarks: record.remarks || "",
      finalCondition: record.finalCondition || "good",
      finalInspectionPassed: "",
      stockLocation: "",
    });
    setMaintenanceError("");
  }

  function closeMaintenance() {
    setManagingRecord(null);
    setMaintenanceForm(null);
    setMaintenanceError("");
  }

  // nextStatus is undefined when just saving details (technician/type/
  // parts/remarks) without advancing the Pending -> In Progress ->
  // Completed lifecycle.
  async function handleMaintenanceSave(nextStatus) {
    setMaintenanceError("");

    if (nextStatus === "completed" && !maintenanceForm.finalInspectionPassed) {
      setMaintenanceError(t("inventory.errFinalInspectionRequired"));
      return;
    }
    const partsResult = partsForSubmit(maintenanceForm.parts);
    if (partsResult.errorRow) {
      setMaintenanceError(t("inventory.errPartRow").replace("{n}", partsResult.errorRow));
      return;
    }

    setMaintenanceSubmitting(true);
    try {
      await updateMaintenanceRecord(managingRecord.id, {
        assignedTechnician: maintenanceForm.assignedTechnician,
        maintenanceType: maintenanceForm.maintenanceType,
        parts: partsResult.parts,
        remarks: maintenanceForm.remarks,
        ...(nextStatus && { status: nextStatus }),
        ...(nextStatus === "completed" && {
          finalCondition: maintenanceForm.finalCondition,
          finalInspectionPassed: maintenanceForm.finalInspectionPassed === "pass",
        }),
      });
      await loadAll();
      closeMaintenance();
    } catch (err) {
      setMaintenanceError(err.message || t("inventory.errMaintenanceUpdateFailed"));
    } finally {
      setMaintenanceSubmitting(false);
    }
  }

  // Passed its final inspection but not yet put back in the armory. The
  // weapon's own status is checked too: records completed before the
  // Return to Stock step existed already put their weapon back to
  // "available", so they aren't waiting on anything.
  function isAwaitingStock(record) {
    return (
      record.status === "completed" &&
      record.finalInspectionPassed === true &&
      !record.returnedToStockAt &&
      record.itemId?.status === "ready_for_stock"
    );
  }

  async function handleReturnToStock() {
    setMaintenanceError("");
    if (!maintenanceForm.stockLocation) {
      setMaintenanceError(t("inventory.errReturnToStockLocation"));
      return;
    }
    setMaintenanceSubmitting(true);
    try {
      await returnMaintenanceToStock(managingRecord.id, { storageLocation: maintenanceForm.stockLocation });
      await loadAll();
      closeMaintenance();
    } catch (err) {
      setMaintenanceError(err.message || t("inventory.errReturnToStockFailed"));
    } finally {
      setMaintenanceSubmitting(false);
    }
  }

  function openInspect(item) {
    setInspectingItem(item);
    setInspectionForm({
      inspectionType: "Scheduled",
      condition: item.condition === "damaged" ? "damaged" : "good",
      findings: "",
      damageIssues: "",
      accessoriesChecked: "",
      remarks: "",
      result: "",
    });
    setInspectionError("");
  }

  function closeInspect() {
    setInspectingItem(null);
    setInspectionForm(null);
    setInspectionError("");
  }

  async function handleInspectionSubmit() {
    setInspectionError("");

    if (!inspectionForm.result) {
      setInspectionError(t("inventory.errInspectionResultRequired"));
      return;
    }

    setInspectionSubmitting(true);
    try {
      await createInspection({
        itemId: inspectingItem.id,
        ...inspectionForm,
      });
      await loadAll();
      closeInspect();
    } catch (err) {
      setInspectionError(err.message || t("inventory.errInspectionFailed"));
    } finally {
      setInspectionSubmitting(false);
    }
  }

  function openReportMissing(item) {
    setReportingMissingItem(item);
    setMissingRemarks("");
    setMissingError("");
  }

  function closeReportMissing() {
    setReportingMissingItem(null);
    setMissingRemarks("");
    setMissingError("");
  }

  async function handleReportMissingSubmit() {
    setMissingSubmitting(true);
    setMissingError("");
    try {
      await reportMissing(reportingMissingItem.id, missingRemarks);
      await loadAll();
      closeReportMissing();
    } catch (err) {
      setMissingError(err.message || t("inventory.errReportMissingFailed"));
    } finally {
      setMissingSubmitting(false);
    }
  }

  if (loading) return <Loader label={t("inventory.loading")} />;

  // The date range only applies to transaction tabs (issue/return/damaged)
  // — the weapons ledger has no dateTime field to filter on.
  function inDateRange(dateTimeValue) {
    if (!dateFrom && !dateTo) return true;
    const d = dateTimeValue?.slice(0, 10);
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  }

  const q = search.trim().toLowerCase();

  function matchesItemSearch(i) {
    if (!q) return true;
    return (
      i.itemId?.toLowerCase().includes(q) ||
      i.itemName?.toLowerCase().includes(q) ||
      i.category?.toLowerCase().includes(q)
    );
  }

  // Ammunition is its own tab, so the Weapon Details ledger holds
  // everything else — firearms, less-lethal and other weapons.
  const weaponItems = items.filter((i) => i.category !== AMMUNITION_CATEGORY);
  const ammunitionItems = items.filter((i) => i.category === AMMUNITION_CATEGORY);
  const filteredItems = weaponItems.filter(
    (i) => (categoryFilter === "all" || i.category === categoryFilter) && matchesItemSearch(i)
  );
  const filteredAmmunition = ammunitionItems.filter(matchesItemSearch);
  const weaponCategoryOptions = WEAPON_CATALOG.filter((c) => c.category !== AMMUNITION_CATEGORY).map((c) => ({
    value: c.category,
    label: c.category,
  }));
  const isAddingAmmunition = addForm.category === AMMUNITION_CATEGORY;

  function filterTransactions(list) {
    return list.filter((tx) => {
      if (!inDateRange(tx.dateTime)) return false;
      if (!q) return true;
      return (
        tx.itemId?.itemId?.toLowerCase().includes(q) ||
        tx.itemId?.itemName?.toLowerCase().includes(q) ||
        tx.officerId?.fullName?.toLowerCase().includes(q) ||
        tx.officerId?.rankAndNumber?.toLowerCase().includes(q) ||
        tx.processedBy?.fullName?.toLowerCase().includes(q) ||
        tx.remarks?.toLowerCase().includes(q)
      );
    });
  }

  const filteredIssueTx = filterTransactions(issueTx);
  const filteredReturnTx = filterTransactions(returnTx);

  // Combined "Audit Ledger" tab — all three transaction types together,
  // newest first, instead of segregated by type like the other tabs.
  // Built from what's already loaded rather than a new endpoint; each
  // transaction already carries its own `type`, so no reshaping needed.
  const allTx = [...issueTx, ...returnTx, ...damagedTx].sort(
    (a, b) => new Date(b.dateTime) - new Date(a.dateTime)
  );
  const filteredLedgerTx = filterTransactions(allTx).filter(
    (tx) => typeFilter === "all" || tx.type === typeFilter
  );

  const filteredMaintenanceRecords = maintenanceRecords.filter((r) => {
    if (!inDateRange(r.reportedDate)) return false;
    if (!q) return true;
    return (
      r.refId?.toLowerCase().includes(q) ||
      r.itemId?.itemId?.toLowerCase().includes(q) ||
      r.itemId?.itemName?.toLowerCase().includes(q) ||
      r.issueDescription?.toLowerCase().includes(q) ||
      r.reportedBy?.fullName?.toLowerCase().includes(q) ||
      r.assignedTechnician?.toLowerCase().includes(q)
    );
  });

  const filteredInspectionRecords = inspectionRecords.filter((r) => {
    if (!inDateRange(r.inspectionDate)) return false;
    if (!q) return true;
    return (
      r.refId?.toLowerCase().includes(q) ||
      r.itemId?.itemId?.toLowerCase().includes(q) ||
      r.itemId?.itemName?.toLowerCase().includes(q) ||
      r.inspectedBy?.fullName?.toLowerCase().includes(q) ||
      r.findings?.toLowerCase().includes(q)
    );
  });

  // Everything physically in the armory (not out with an officer, and
  // not currently missing) is eligible for a "Due Inspections" alert —
  // that's the whole point of this flow: catching weapons nobody's
  // touched via Issue/Return/Maintenance in a while. Sorted soonest-due
  // first so the most urgent items are at the top.
  const inspectableItems = items
    .filter((i) => i.category !== AMMUNITION_CATEGORY && i.status !== "issued" && i.status !== "missing")
    .slice()
    .sort((a, b) => {
      if (!a.nextInspectionDate) return 1;
      if (!b.nextInspectionDate) return -1;
      return new Date(a.nextInspectionDate) - new Date(b.nextInspectionDate);
    });

  const nowDate = new Date();
  const today = nowDate.toISOString().slice(0, 10);
  const dueSoonCutoff = new Date(nowDate.getTime() + INSPECTION_DUE_SOON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  function inspectionAlert(item) {
    if (item.status === "damaged") return { labelKey: "alertFailed", tone: "danger" };
    const due = item.nextInspectionDate?.slice(0, 10);
    if (!due) return null;
    if (due < today) return { labelKey: "alertOverdue", tone: "danger" };
    if (due <= dueSoonCutoff) return { labelKey: "alertDueSoon", tone: "warning" };
    return null;
  }

  const overdueCount = inspectableItems.filter((i) => inspectionAlert(i)?.labelKey === "alertOverdue").length;
  const dueSoonCount = inspectableItems.filter((i) => inspectionAlert(i)?.labelKey === "alertDueSoon").length;

  const itemsPage = paginate(filteredItems, page);
  const ammunitionPage = paginate(filteredAmmunition, page);
  const issueTxPage = paginate(filteredIssueTx, page);
  const returnTxPage = paginate(filteredReturnTx, page);
  const ledgerTxPage = paginate(filteredLedgerTx, page);
  const maintenancePage = paginate(filteredMaintenanceRecords, page);
  const inspectionHistoryPageData = paginate(filteredInspectionRecords, inspectionHistoryPage);

  const filtersActive = Boolean(
    search.trim() || dateFrom || dateTo || categoryFilter !== "all" || typeFilter !== "all"
  );

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setCategoryFilter("all");
    setTypeFilter("all");
  }

  const ledgerColumns = [
    { key: "itemId", label: t("inventory.colItemId") },
    { key: "serialNumber", label: t("inventory.colSerialNumber"), render: (row) => row.serialNumber || "—" },
    { key: "itemName", label: t("inventory.colItemName") },
    { key: "category", label: t("inventory.colCategory") },
    { key: "caliber", label: t("inventory.colCaliber"), render: (row) => row.caliber || "—" },
    { key: "storageLocation", label: t("inventory.colStorageLocation"), render: (row) => row.storageLocation || "—" },
    { key: "quantity", label: t("inventory.colQuantity") },
    { key: "status", label: t("common.status"), render: (row) => <Badge status={row.status} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "",
            render: (row) =>
              row.status === "issued" ? (
                <Button variant="ghost" onClick={() => openReportMissing(row)}>
                  {t("inventory.reportMissing")}
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  function isLowStock(row) {
    return row.lowStockThreshold !== null && row.lowStockThreshold !== undefined && row.quantity <= row.lowStockThreshold;
  }

  const ammunitionColumns = [
    { key: "itemId", label: t("inventory.ammunitionBatchId") },
    { key: "itemName", label: t("inventory.ammunitionType") },
    { key: "quantity", label: t("inventory.roundsInStock") },
    { key: "lowStockThreshold", label: t("inventory.lowStockThreshold"), render: (row) => row.lowStockThreshold ?? "—" },
    { key: "storageLocation", label: t("inventory.colStorageLocation"), render: (row) => row.storageLocation || "—" },
    {
      key: "status",
      label: t("common.status"),
      render: (row) => (isLowStock(row) ? <Badge tone="warning">{t("inventory.lowStock")}</Badge> : <Badge status={row.status} />),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "",
            render: (row) => (
              <Button variant="ghost" onClick={() => setRestockingItem(row)}>
                {t("inventory.restock")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  // itemId/officerId/processedBy come back as populated sub-documents
  // (see listTransactions in inventoryController.js), not plain strings
  // — all three need a render accessor rather than the raw row[key]
  // lookup, or React throws trying to render an object.
  //
  // NOTE: InventoryTransaction has no "status" field — every prior
  // version of this table had a "Status" column bound to row.status,
  // which was always blank. Swapped for "Processed By" (processedBy),
  // which is real data and wasn't shown anywhere before.

  // Display-only — deliberately no click handler, dropdown, or any other
  // control here. The receiving officer's own confirmation (My Weapons
  // page -> confirmReceipt) is the only thing that can move this from
  // pending to secured; the Inventory Officer can only ever look.
  function renderConfirmation(row) {
    if (row.confirmationStatus === "secured") {
      return <Badge tone="success" title={row.confirmationRemarks || undefined}>{t("inventory.secured")}</Badge>;
    }
    if (row.confirmationStatus === "pending") {
      return <Badge tone="warning">{t("inventory.pendingConfirmation")}</Badge>;
    }
    return "—";
  }

  const issueColumns = [
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "officerId", label: t("inventory.colOfficerName"), render: (row) => row.officerId?.fullName || row.officerId?.rankAndNumber || "—" },
    { key: "department", label: t("personnel.colDepartment"), render: (row) => row.officerId?.department || "—" },
    { key: "dutyType", label: t("inventory.colDutyType") },
    { key: "dateTime", label: t("inventory.colDateTime"), render: (row) => formatDateTime(row.dateTime) },
    {
      key: "ammoIssued",
      label: t("inventory.ammoIssued"),
      render: (row) => {
        if (!row.ammoIssued) return "—";
        // Older issues recorded rounds without linking an ammunition batch.
        return row.ammoItemId?.itemName ? `${row.ammoIssued} × ${row.ammoItemId.itemName}` : row.ammoIssued;
      },
    },
    { key: "accessories", label: t("inventory.accessories"), render: (row) => row.accessories || "—" },
    { key: "confirmationStatus", label: t("inventory.colConfirmation"), render: renderConfirmation },
    { key: "processedBy", label: t("inventory.colProcessedBy"), render: (row) => row.processedBy?.fullName || row.processedBy?.rankAndNumber || "—" },
  ];

  function renderAmmoUsed(row) {
    return row.ammoUsed === null || row.ammoUsed === undefined ? "—" : row.ammoUsed;
  }

  function renderDiscrepancy(row) {
    if (row.ammoDiscrepancy === null || row.ammoDiscrepancy === undefined) return "—";
    if (row.ammoDiscrepancy === 0) return <Badge tone="success">{t("inventory.reconciled")}</Badge>;
    return <Badge tone="danger">{row.ammoDiscrepancy > 0 ? `−${row.ammoDiscrepancy}` : `+${-row.ammoDiscrepancy}`}</Badge>;
  }

  const returnColumns = [
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "officerId", label: t("inventory.colOfficerName"), render: (row) => row.officerId?.fullName || row.officerId?.rankAndNumber || "—" },
    { key: "department", label: t("personnel.colDepartment"), render: (row) => row.officerId?.department || "—" },
    { key: "dutyType", label: t("inventory.colDutyType") },
    { key: "dateTime", label: t("inventory.colDateTime"), render: (row) => formatDateTime(row.dateTime) },
    { key: "condition", label: t("inventory.colCondition"), render: (row) => (row.condition ? <Badge status={row.condition} /> : "—") },
    { key: "ammoUsed", label: t("inventory.ammoUsed"), render: renderAmmoUsed },
    { key: "ammoDiscrepancy", label: t("inventory.ammoDiscrepancy"), render: renderDiscrepancy },
    {
      key: "accessoriesComplete",
      label: t("inventory.accessories"),
      render: (row) =>
        row.accessoriesComplete === null || row.accessoriesComplete === undefined ? (
          "—"
        ) : row.accessoriesComplete ? (
          <Badge tone="success">{t("inventory.accessoriesAllReturned")}</Badge>
        ) : (
          <Badge tone="danger">{t("inventory.accessoriesMissing")}</Badge>
        ),
    },
    { key: "remarks", label: t("inventory.colRemarks"), render: (row) => row.remarks || "—" },
    { key: "confirmationStatus", label: t("inventory.colConfirmation"), render: renderConfirmation },
    { key: "processedBy", label: t("inventory.colProcessedBy"), render: (row) => row.processedBy?.fullName || row.processedBy?.rankAndNumber || "—" },
  ];

  const TX_TYPE = {
    issue: { labelKey: "typeIssue", tone: "info" },
    return: { labelKey: "typeReturn", tone: "success" },
    damaged: { labelKey: "typeDamaged", tone: "danger" },
  };
  const ledgerTxColumns = [
    { key: "dateTime", label: t("inventory.colDateTime"), render: (row) => formatDateTime(row.dateTime) },
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    {
      key: "type",
      label: t("inventory.colType"),
      render: (row) => {
        const meta = TX_TYPE[row.type];
        return meta ? <Badge tone={meta.tone}>{t(`inventory.${meta.labelKey}`)}</Badge> : "—";
      },
    },
    { key: "officerId", label: t("inventory.colOfficerName"), render: (row) => row.officerId?.fullName || row.officerId?.rankAndNumber || "—" },
    { key: "quantity", label: t("inventory.colQuantity") },
    { key: "condition", label: t("inventory.colCondition"), render: (row) => (row.condition ? <Badge status={row.condition} /> : "—") },
    { key: "ammoUsed", label: t("inventory.ammoUsed"), render: renderAmmoUsed },
    { key: "confirmationStatus", label: t("inventory.colConfirmation"), render: renderConfirmation },
    { key: "processedBy", label: t("inventory.colProcessedBy"), render: (row) => row.processedBy?.fullName || row.processedBy?.rankAndNumber || "—" },
  ];

  const MAINTENANCE_STATUS = {
    pending: { labelKey: "maintStatusPending", tone: "warning" },
    in_progress: { labelKey: "maintStatusInProgress", tone: "info" },
    completed: { labelKey: "maintStatusCompleted", tone: "success" },
  };
  const maintenanceColumns = [
    { key: "refId", label: t("inventory.colMaintenanceId") },
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "issueDescription", label: t("inventory.colIssueDescription") },
    { key: "reportedBy", label: t("inventory.colReportedBy"), render: (row) => row.reportedBy?.fullName || row.reportedBy?.rankAndNumber || "—" },
    { key: "reportedDate", label: t("inventory.colReportedDate"), render: (row) => formatDate(row.reportedDate) },
    { key: "maintenanceType", label: t("inventory.colMaintenanceType") },
    { key: "assignedTechnician", label: t("inventory.colAssignedTechnician"), render: (row) => row.assignedTechnician || "—" },
    { key: "totalCost", label: t("inventory.totalCost"), render: (row) => (row.parts?.length ? formatLkr(row.totalCost) : "—") },
    {
      key: "status",
      label: t("common.status"),
      render: (row) => {
        if (isAwaitingStock(row)) return <Badge status="ready_for_stock" />;
        const meta = MAINTENANCE_STATUS[row.status];
        return meta ? <Badge tone={meta.tone}>{t(`inventory.${meta.labelKey}`)}</Badge> : "—";
      },
    },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "",
            render: (row) => (
              <Button variant={isAwaitingStock(row) ? "primary" : "ghost"} onClick={() => openMaintenance(row)}>
                {isAwaitingStock(row)
                  ? t("inventory.returnToStock")
                  : row.status === "completed"
                    ? t("common.view")
                    : t("inventory.manage")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const dueInspectionColumns = [
    { key: "itemId", label: t("inventory.colItemId") },
    { key: "itemName", label: t("inventory.colItemName") },
    { key: "category", label: t("inventory.colCategory") },
    { key: "lastInspectionDate", label: t("inventory.colLastInspection"), render: (row) => (row.lastInspectionDate ? formatDate(row.lastInspectionDate) : "—") },
    { key: "nextInspectionDate", label: t("inventory.colNextInspection"), render: (row) => (row.nextInspectionDate ? formatDate(row.nextInspectionDate) : "—") },
    {
      key: "alert",
      label: t("inventory.colAlert"),
      render: (row) => {
        const alert = inspectionAlert(row);
        return alert ? <Badge tone={alert.tone}>{t(`inventory.${alert.labelKey}`)}</Badge> : <Badge tone="success">{t("inventory.alertOk")}</Badge>;
      },
    },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "",
            render: (row) => (
              <Button variant="primary" onClick={() => openInspect(row)}>
                {t("inventory.inspect")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const inspectionHistoryColumns = [
    { key: "refId", label: t("inventory.colInspectionId") },
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "inspectedBy", label: t("inventory.colInspector"), render: (row) => row.inspectedBy?.fullName || row.inspectedBy?.rankAndNumber || "—" },
    { key: "inspectionDate", label: t("inventory.colInspectionDate"), render: (row) => formatDate(row.inspectionDate) },
    { key: "inspectionType", label: t("inventory.colInspectionType") },
    {
      key: "result",
      label: t("inventory.colResult"),
      render: (row) => (row.result === "passed" ? <Badge tone="success">{t("inventory.inspectionPassed")}</Badge> : <Badge tone="danger">{t("inventory.inspectionFailed")}</Badge>),
    },
    { key: "nextInspectionDate", label: t("inventory.colNextInspection"), render: (row) => (row.nextInspectionDate ? formatDate(row.nextInspectionDate) : "—") },
  ];

  return (
    <div>
      <div className="inventory-header">
        <h1>{t("inventory.dashboardTitle")}</h1>
        {canManage && (
          <div className="inventory-header-actions">
            <Button variant="outline" onClick={() => setOpenModal("issue")}>{t("inventory.issueItem")}</Button>
            <Button variant="outline" onClick={() => setOpenModal("return")}>{t("inventory.returnItem")}</Button>
            <Button variant="primary" onClick={() => setOpenModal("add")}>{t("inventory.addNewItem")}</Button>
          </div>
        )}
      </div>
      <p className="inventory-subtitle">{t("inventory.stationAssetRegistry")} {stats?.stationLabel}</p>

      <div className="stat-grid">
        <StatCard label={t("inventory.totalAssets")} value={stats?.totalAssets} caption={t("inventory.allCategoriesCombined")} />
        <StatCard label={t("inventory.issuedItems")} value={stats?.issuedItems} caption={t("inventory.currentlyInUse")} />
        <StatCard label={t("inventory.availableStock")} value={stats?.availableStock} caption={t("inventory.readyForDeployment")} />
        <StatCard label={t("inventory.damagedRepairs")} value={stats?.damagedRepairs} caption={t("inventory.requiresAttention")} />
      </div>

      <div className="inventory-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`inventory-tab${activeTab === tab.key ? " active" : ""}`}
            onClick={() => {
              setActiveTab(tab.key);
              setPage(1);
              setInspectionHistoryPage(1);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="inventory-filter-bar">
        <div className="inventory-filter-search">
          <InputField
            label={t("inventory.searchLedger")}
            placeholder={t("inventory.searchLedgerPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sinhalaTyping
          />
        </div>
        {activeTab === "weapons" && (
          <InputField
            label={t("inventory.colCategory")}
            type="select"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            options={[{ value: "all", label: t("inventory.allCategories") }, ...weaponCategoryOptions]}
          />
        )}
        {activeTab !== "weapons" && activeTab !== "ammunition" && (
          <>
            <InputField label={t("inventory.dateFrom")} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <InputField label={t("inventory.dateTo")} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </>
        )}
        {activeTab === "ledger" && (
          <InputField
            label={t("inventory.colType")}
            type="select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            options={[
              { value: "all", label: t("inventory.allTypes") },
              { value: "issue", label: t("inventory.typeIssue") },
              { value: "return", label: t("inventory.typeReturn") },
              { value: "damaged", label: t("inventory.typeDamaged") },
            ]}
          />
        )}
        {filtersActive && (
          <Button variant="ghost" type="button" onClick={clearFilters}>
            {t("inventory.clearFilters")}
          </Button>
        )}
      </div>

      <Card variant="panel">
        {activeTab === "weapons" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.equipmentLedgerTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.equipmentLedgerSubtitle")}</p>
            <Table columns={ledgerColumns} data={itemsPage.items} emptyMessage={t("inventory.noInventoryItems")} />
            <Pagination page={itemsPage.safePage} totalPages={itemsPage.totalPages} onPageChange={setPage} />
            <div className="inventory-footer-row">
              <span>{t("inventory.showingItems")} {filteredItems.length} / {weaponItems.length} {t("inventory.ofItemsRegistered")}</span>
            </div>
          </>
        )}

        {activeTab === "ammunition" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.ammunitionLedgerTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.ammunitionLedgerSubtitle")}</p>
            <Table columns={ammunitionColumns} data={ammunitionPage.items} emptyMessage={t("inventory.noAmmunitionItems")} />
            <Pagination page={ammunitionPage.safePage} totalPages={ammunitionPage.totalPages} onPageChange={setPage} />
            <div className="inventory-footer-row">
              <span>{t("inventory.showingItems")} {filteredAmmunition.length} / {ammunitionItems.length} {t("inventory.ofItemsRegistered")}</span>
            </div>
          </>
        )}

        {activeTab === "issue" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.issuingLogTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.issuingLogSubtitle")}</p>
            <Table columns={issueColumns} data={issueTxPage.items} emptyMessage={t("inventory.noItemsIssued")} />
            <Pagination page={issueTxPage.safePage} totalPages={issueTxPage.totalPages} onPageChange={setPage} />
          </>
        )}

        {activeTab === "return" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.returnedLogTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.returnedLogSubtitle")}</p>
            <Table columns={returnColumns} data={returnTxPage.items} emptyMessage={t("inventory.noReturnsRecorded")} />
            <Pagination page={returnTxPage.safePage} totalPages={returnTxPage.totalPages} onPageChange={setPage} />
          </>
        )}

        {activeTab === "ledger" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.auditLedgerTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.auditLedgerSubtitle")}</p>
            <Table columns={ledgerTxColumns} data={ledgerTxPage.items} emptyMessage={t("inventory.noLedgerEntries")} />
            <Pagination page={ledgerTxPage.safePage} totalPages={ledgerTxPage.totalPages} onPageChange={setPage} />
            <div className="inventory-footer-row">
              <span>{t("inventory.showingItems")} {filteredLedgerTx.length} / {allTx.length} {t("inventory.ofEntriesTotal")}</span>
            </div>
          </>
        )}

        {activeTab === "maintenance" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.maintenanceTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.maintenanceSubtitle")}</p>
            <Table columns={maintenanceColumns} data={maintenancePage.items} emptyMessage={t("inventory.noMaintenanceRecords")} />
            <Pagination page={maintenancePage.safePage} totalPages={maintenancePage.totalPages} onPageChange={setPage} />
          </>
        )}

        {activeTab === "inspections" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.dueInspectionsTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.dueInspectionsSubtitle")}</p>
            <div className="inventory-inspection-stats">
              <span className="inventory-inspection-stat inventory-inspection-stat-danger">{overdueCount} {t("inventory.alertOverdue")}</span>
              <span className="inventory-inspection-stat inventory-inspection-stat-warning">{dueSoonCount} {t("inventory.alertDueSoon")}</span>
            </div>
            <Table columns={dueInspectionColumns} data={inspectableItems} emptyMessage={t("inventory.noInspectableItems")} />

            <h3 className="section-label">{t("inventory.inspectionHistoryTitle")}</h3>
            <Table columns={inspectionHistoryColumns} data={inspectionHistoryPageData.items} emptyMessage={t("inventory.noInspectionRecords")} />
            <Pagination page={inspectionHistoryPageData.safePage} totalPages={inspectionHistoryPageData.totalPages} onPageChange={setInspectionHistoryPage} />
          </>
        )}

      </Card>

      <Modal
        open={openModal === "issue"}
        onClose={closeModal}
        title={t("inventory.issueItemForm")}
        footer={
          <Button variant="primary" fullWidth onClick={handleIssueSubmit} disabled={submitting}>
            {submitting ? t("inventory.processing") : t("inventory.confirmIssueTransaction")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("inventory.recordIssuingText")}
        </p>
        <div className="modal-form-grid">
          <SearchableSelect
            label={t("inventory.officerId")}
            required
            value={issueForm.officer}
            onChange={(opt) => setIssueForm((f) => ({ ...f, officer: opt }))}
            searchFn={searchOfficersByRank}
            placeholder={t("leave.searchOfficerPlaceholder")}
          />
          <InputField
            label={t("personnel.colDepartment")}
            readOnly
            value={issueForm.officer ? issueForm.officer.department || "—" : ""}
            placeholder={t("inventory.departmentAuto")}
          />
          <SearchableSelect
            label={t("inventory.weaponSerialId")}
            required
            value={issueForm.item}
            onChange={(opt) => setIssueForm((f) => ({ ...f, item: opt, accessories: [] }))}
            searchFn={searchIssuableItems}
            placeholder={t("inventory.weaponSerialId")}
          />
          {/* Shown for reference only — the server stamps the real time
              when Confirm is pressed (see issue() in inventoryController.js). */}
          <InputField
            label={t("inventory.issuedAt")}
            readOnly
            value={formatDateTime(new Date().toISOString())}
            helperText={t("inventory.issuedAtHelper")}
          />
          <InputField
            label={t("inventory.expectedReturnDate")}
            type="date"
            value={issueForm.expectedReturnDate}
            onChange={(e) => setIssueForm((f) => ({ ...f, expectedReturnDate: e.target.value }))}
            helperText={t("inventory.expectedReturnDateHelper")}
          />
        </div>
        {issueForm.item && (
          <CheckboxGroup
            label={t("inventory.accessories")}
            options={accessoriesForType(issueForm.item.itemName)}
            selected={issueForm.accessories}
            onChange={(list) => setIssueForm((f) => ({ ...f, accessories: list }))}
            emptyText={t("inventory.noAccessoriesForType")}
          />
        )}

        <h3 className="section-label">{t("inventory.ammoIssueTitle")}</h3>
        <div className="modal-form-grid">
          <SearchableSelect
            label={t("inventory.ammunitionStock")}
            minChars={0}
            value={issueForm.ammoItem}
            onChange={(opt) => setIssueForm((f) => ({ ...f, ammoItem: opt }))}
            searchFn={searchAmmunitionStock}
            placeholder={t("inventory.selectAmmunitionStock")}
          />
          <InputField
            label={t("inventory.ammoIssued")}
            type="number"
            min="0"
            max={issueForm.ammoItem?.quantity}
            value={issueForm.ammoIssued}
            onChange={(e) => setIssueForm((f) => ({ ...f, ammoIssued: capRounds(e.target.value, f.ammoItem?.quantity) }))}
            helperText={
              issueForm.ammoItem
                ? `${issueForm.ammoItem.quantity} ${t("inventory.roundsAvailable")}`
                : t("inventory.ammoIssuedAtIssueHelper")
            }
          />
        </div>
        {modalError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{modalError}</p>}
      </Modal>

      <Modal
        open={openModal === "return"}
        onClose={closeModal}
        title={t("inventory.returnItemForm")}
        footer={
          <Button variant="primary" fullWidth onClick={handleReturnSubmit} disabled={submitting}>
            {submitting ? t("inventory.processing") : t("inventory.processReturnAudit")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("inventory.recordReturningText")}
        </p>
        <div className="modal-form-grid">
          <SearchableSelect
            label={t("inventory.officerId")}
            required
            value={returnForm.officer}
            onChange={(opt) => {
              setReturnForm((f) => ({ ...f, officer: opt, item: null, ammoIssued: "" }));
              setReturnSourceIssue(null);
            }}
            searchFn={searchOfficersByRank}
            placeholder={t("leave.searchOfficerPlaceholder")}
          />
          <InputField
            label={t("personnel.colDepartment")}
            readOnly
            value={returnForm.officer ? returnForm.officer.department || "—" : ""}
            placeholder={t("inventory.departmentAuto")}
          />
          <SearchableSelect
            label={t("inventory.weaponSerialId")}
            required
            minChars={0}
            value={returnForm.item}
            onChange={(opt) => {
              // Pre-fill from the officer's own matching issue record —
              // "choose the weapon, the rest fills itself in" instead of
              // re-typing facts already on file. Still just a starting
              // point: every field stays editable for a partial return
              // or a correction.
              const sourceIssue = findOpenIssueRecord(returnForm.officer?.value, opt?.value);
              setReturnSourceIssue(sourceIssue);
              setReturnForm((f) => ({
                ...f,
                item: opt,
                ammoIssued: sourceIssue?.ammoIssued != null ? String(sourceIssue.ammoIssued) : "",
              }));
            }}
            searchFn={searchOfficerIssuedItems}
            placeholder={returnForm.officer ? t("inventory.weaponSerialId") : t("inventory.selectOfficerFirst")}
            helperText={
              returnSourceIssue
                ? `${t("inventory.prefilledFromIssue")} ${formatDate(returnSourceIssue.dateTime)} (${returnSourceIssue.dutyType || "—"})`
                : undefined
            }
          />
          <InputField label={t("inventory.returnDate")} type="date" value={returnForm.returnDate} onChange={(e) => setReturnForm((f) => ({ ...f, returnDate: e.target.value }))} />
          <InputField
            label={t("inventory.weaponCondition")}
            type="select"
            required
            value={returnForm.condition}
            // Switching back to Good clears any reason typed for Faulty.
            onChange={(e) =>
              setReturnForm((f) => ({ ...f, condition: e.target.value, faultReason: e.target.value === "Faulty" ? f.faultReason : "" }))
            }
            // A fixed choice, not free text — the server only ever
            // classifies a return as damaged when this is exactly
            // "Faulty" (see returnItem() in inventoryController.js), so
            // free typing let a genuinely damaged weapon silently go
            // back into available stock on anything but that exact word
            // ("Damaged", "Broken scope", a typo, ...).
            options={[
              { value: "Good", label: t("status.good") },
              { value: "Faulty", label: t("status.faulty") },
            ]}
          />
        </div>
        {returnForm.condition === "Faulty" && (
          <InputField
            label={t("inventory.faultReason")}
            type="textarea"
            rows={3}
            required
            value={returnForm.faultReason}
            placeholder={t("inventory.faultReasonPlaceholder")}
            helperText={t("inventory.faultReasonHelper")}
            onChange={(e) => setReturnForm((f) => ({ ...f, faultReason: e.target.value }))}
            voiceInput
            sinhalaTyping
          />
        )}

        <h3 className="section-label">{t("inventory.accessoriesCheckTitle")}</h3>
        {returnSourceIssue?.accessories && (
          <p className="inventory-pending-note">
            {t("inventory.issuedWith")}: {returnSourceIssue.accessories}
          </p>
        )}
        <div className="modal-form-grid">
          <InputField
            label={t("inventory.accessoriesAllReturnedQ")}
            type="select"
            value={returnForm.accessoriesComplete}
            onChange={(e) => setReturnForm((f) => ({ ...f, accessoriesComplete: e.target.value }))}
            placeholder={t("inventory.selectOption")}
            options={[
              { value: "true", label: t("inventory.yes") },
              { value: "false", label: t("inventory.no") },
            ]}
          />
          {returnForm.accessoriesComplete === "false" && (
            <InputField
              label={t("inventory.accessoriesNote")}
              value={returnForm.accessoriesRemarks}
              placeholder={t("inventory.accessoriesNotePlaceholder")}
              onChange={(e) => setReturnForm((f) => ({ ...f, accessoriesRemarks: e.target.value }))}
            />
          )}
        </div>
        {returnForm.accessoriesComplete === "false" && returnSourceIssue?.accessories && (
          <CheckboxGroup
            label={t("inventory.accessoriesMissingWhich")}
            options={returnSourceIssue.accessories.split(", ")}
            selected={returnForm.missingAccessories}
            onChange={(list) => setReturnForm((f) => ({ ...f, missingAccessories: list }))}
          />
        )}

        <h3 className="section-label">{t("inventory.ammoCheckTitle")}</h3>
        {returnSourceIssue?.ammoItemId?.itemName && (
          <p className="inventory-pending-note">
            {returnSourceIssue.ammoItemId.itemName} — {returnSourceIssue.ammoItemId.itemId}
          </p>
        )}
        {returnForm.item && !(Number(returnForm.ammoIssued) > 0) ? (
          <p className="inventory-pending-note">{t("inventory.noAmmoIssued")}</p>
        ) : (
        <div className="modal-form-grid">
          <InputField
            label={t("inventory.ammoIssued")}
            type="number"
            // Fixed at issue time — shown from the issue record, never
            // typed here (the server ignores it anyway).
            readOnly
            value={returnForm.ammoIssued}
            helperText={t("inventory.ammoIssuedFixedHelper")}
          />
          <InputField
            label={t("inventory.ammoReturned")}
            type="number"
            min="0"
            max={returnForm.ammoIssued}
            value={returnForm.ammoReturned}
            onChange={(e) => setReturnForm((f) => ({ ...f, ammoReturned: capRounds(e.target.value, Number(f.ammoIssued)) }))}
            helperText={`${t("inventory.ammoReturnedHelper")} (${t("inventory.maxRounds").replace("{n}", returnForm.ammoIssued || 0)})`}
          />
          <InputField
            label={t("inventory.ammoDeclaredUsed")}
            type="number"
            min="0"
            max={returnForm.ammoIssued}
            value={returnForm.ammoDeclaredUsed}
            onChange={(e) => setReturnForm((f) => ({ ...f, ammoDeclaredUsed: capRounds(e.target.value, Number(f.ammoIssued)) }))}
            helperText={`${t("inventory.ammoDeclaredUsedHelper")} (${t("inventory.maxRounds").replace("{n}", returnForm.ammoIssued || 0)})`}
          />
          {returnForm.ammoIssued !== "" && returnForm.ammoReturned !== "" && (
            <InputField
              label={t("inventory.ammoUsed")}
              readOnly
              value={Number(returnForm.ammoIssued) - Number(returnForm.ammoReturned)}
            />
          )}
        </div>
        )}
        {returnForm.ammoIssued !== "" && returnForm.ammoReturned !== "" && returnForm.ammoDeclaredUsed !== "" && (() => {
          const gap =
            Number(returnForm.ammoIssued) - Number(returnForm.ammoReturned) - Number(returnForm.ammoDeclaredUsed);
          return gap === 0 ? (
            <p className="inventory-pending-note">{t("inventory.ammoReconciledNote")}</p>
          ) : (
            <p style={{ color: "var(--color-danger)", fontSize: 13, marginTop: 8 }}>
              {t("inventory.ammoDiscrepancyNote").replace("{n}", Math.abs(gap))}
            </p>
          );
        })()}

        <p className="inventory-pending-note">{t("inventory.returnPendingNote")}</p>
        {modalError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{modalError}</p>}
      </Modal>

      <Modal
        open={openModal === "add"}
        onClose={closeModal}
        title={t("inventory.addNewItemForm")}
        footer={
          <Button variant="primary" fullWidth onClick={handleAddSubmit} disabled={submitting}>
            {submitting ? t("inventory.processing") : t("inventory.confirmAdd")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("inventory.recordNewItemText")}
        </p>
        <div className="modal-form-grid">
          <InputField
            label={t("inventory.colCategory")}
            type="select"
            required
            value={addForm.category}
            // The type list depends on the category, so a category change
            // clears whatever type was picked under the old one.
            onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value, weaponType: "", caliber: "" }))}
            placeholder={t("inventory.selectCategory")}
            options={WEAPON_CATALOG.map((c) => ({ value: c.category, label: c.category }))}
          />
          <InputField
            label={isAddingAmmunition ? t("inventory.ammunitionType") : t("inventory.weaponType")}
            type="select"
            required
            value={addForm.weaponType}
            onChange={(e) => {
              // A type with only one caliber (Pistol -> 9mm) fills it in;
              // otherwise it's picked below.
              const calibers = calibersForType(e.target.value);
              setAddForm((f) => ({ ...f, weaponType: e.target.value, caliber: calibers.length === 1 ? calibers[0] : "" }));
            }}
            placeholder={addForm.category ? t("inventory.selectType") : t("inventory.selectCategoryFirst")}
            options={typesForCategory(addForm.category).map((type) => ({ value: type, label: type }))}
          />
          <InputField
            label={isAddingAmmunition ? t("inventory.ammunitionBatchId") : t("inventory.weaponId")}
            required
            value={addForm.weaponSerialId}
            placeholder={isAddingAmmunition ? undefined : "12345"}
            helperText={isAddingAmmunition ? undefined : t("inventory.fiveDigitsHelper")}
            onChange={(e) =>
              setAddForm((f) => ({
                ...f,
                weaponSerialId: f.category === AMMUNITION_CATEGORY ? e.target.value : toFiveDigits(e.target.value),
              }))
            }
          />
          {!isAddingAmmunition && (
            <InputField
              label={t("inventory.colSerialNumber")}
              required
              value={addForm.serialNumber}
              placeholder="12345"
              helperText={t("inventory.fiveDigitsHelper")}
              onChange={(e) => setAddForm((f) => ({ ...f, serialNumber: toFiveDigits(e.target.value) }))}
            />
          )}
          <InputField
            label={isAddingAmmunition ? t("inventory.roundsToAdd") : t("inventory.quantityToAdd")}
            required
            type="number"
            min="0"
            value={addForm.quantity}
            onChange={(e) => setAddForm((f) => ({ ...f, quantity: e.target.value }))}
          />
          {addForm.category === "Firearms" &&
            addForm.weaponType &&
            (calibersForType(addForm.weaponType).length > 1 ? (
              <InputField
                label={t("inventory.colCaliber")}
                type="select"
                required
                value={addForm.caliber}
                placeholder={t("inventory.selectCaliber")}
                onChange={(e) => setAddForm((f) => ({ ...f, caliber: e.target.value }))}
                options={calibersForType(addForm.weaponType).map((c) => ({ value: c, label: c }))}
              />
            ) : (
              <InputField label={t("inventory.colCaliber")} readOnly value={addForm.caliber} />
            ))}
          <InputField
            label={t("inventory.colStorageLocation")}
            type="select"
            value={addForm.storageLocation}
            placeholder={t("inventory.selectStorageLocation")}
            onChange={(e) => setAddForm((f) => ({ ...f, storageLocation: e.target.value }))}
            options={STORAGE_LOCATIONS.map((loc) => ({ value: loc, label: loc }))}
          />
          {isAddingAmmunition ? (
            <InputField
              label={t("inventory.lowStockThreshold")}
              type="number"
              min="0"
              value={addForm.lowStockThreshold}
              onChange={(e) => setAddForm((f) => ({ ...f, lowStockThreshold: e.target.value }))}
              helperText={t("inventory.lowStockThresholdHelper")}
            />
          ) : (
            <>
              <InputField
                label={t("inventory.colCondition")}
                type="select"
                value={addForm.condition}
                onChange={(e) => setAddForm((f) => ({ ...f, condition: e.target.value }))}
                options={[
                  { value: "good", label: t("status.good") },
                  { value: "fair", label: t("inventory.conditionFair") },
                ]}
              />
              <InputField
                label={t("inventory.lastInspectionDate")}
                type="date"
                value={addForm.lastInspectionDate}
                onChange={(e) => setAddForm((f) => ({ ...f, lastInspectionDate: e.target.value }))}
                helperText={t("inventory.lastInspectionDateHelper")}
              />
            </>
          )}
        </div>
        {modalError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{modalError}</p>}
      </Modal>

      <Modal
        open={Boolean(restockingItem)}
        onClose={closeModal}
        title={restockingItem ? `${t("inventory.restock")} — ${restockingItem.itemName} (${restockingItem.itemId})` : ""}
        footer={
          <Button variant="primary" fullWidth onClick={handleRestockSubmit} disabled={submitting}>
            {submitting ? t("inventory.processing") : t("inventory.confirmRestock")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("inventory.currentStock")}: {restockingItem?.quantity}
        </p>
        <div className="modal-form-grid">
          <InputField
            label={t("inventory.roundsToAdd")}
            required
            type="number"
            min="1"
            value={restockForm.quantity}
            onChange={(e) => setRestockForm((f) => ({ ...f, quantity: e.target.value }))}
          />
          <InputField
            label={t("inventory.colRemarks")}
            value={restockForm.remarks}
            placeholder={t("inventory.restockRemarksPlaceholder")}
            onChange={(e) => setRestockForm((f) => ({ ...f, remarks: e.target.value }))}
          />
        </div>
        {modalError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{modalError}</p>}
      </Modal>

      <Modal
        open={Boolean(managingRecord)}
        onClose={closeMaintenance}
        title={managingRecord ? `${t("inventory.manageMaintenance")} — ${managingRecord.refId}` : ""}
        footer={
          managingRecord && isAwaitingStock(managingRecord) ? (
            <Button variant="primary" fullWidth onClick={handleReturnToStock} disabled={maintenanceSubmitting}>
              {maintenanceSubmitting ? t("inventory.processing") : t("inventory.returnToStock")}
            </Button>
          ) : (
            managingRecord?.status !== "completed" && (
            <div style={{ display: "flex", gap: 12, width: "100%" }}>
              <Button variant="outline" fullWidth onClick={() => handleMaintenanceSave()} disabled={maintenanceSubmitting}>
                {t("inventory.saveDetails")}
              </Button>
              <Button
                variant="primary"
                fullWidth
                onClick={() => handleMaintenanceSave(managingRecord?.status === "pending" ? "in_progress" : "completed")}
                disabled={maintenanceSubmitting}
              >
                {maintenanceSubmitting
                  ? t("inventory.processing")
                  : managingRecord?.status === "pending"
                  ? t("inventory.startMaintenance")
                  : t("inventory.completeMaintenance")}
              </Button>
            </div>
            )
          )
        }
      >
        {managingRecord && maintenanceForm && (
          <>
            <div className="inventory-maintenance-summary">
              <p><strong>{t("inventory.colItemId")}:</strong> {managingRecord.itemId?.itemId || managingRecord.itemId?.itemName || "—"}</p>
              <p><strong>{t("inventory.colIssueDescription")}:</strong> {managingRecord.issueDescription}</p>
              <p><strong>{t("inventory.colReportedBy")}:</strong> {managingRecord.reportedBy?.fullName || managingRecord.reportedBy?.rankAndNumber || "—"}</p>
              <p><strong>{t("inventory.colReportedDate")}:</strong> {formatDate(managingRecord.reportedDate)}</p>
            </div>

            <div className="modal-form-grid">
              <InputField
                label={t("inventory.colAssignedTechnician")}
                value={maintenanceForm.assignedTechnician}
                readOnly={managingRecord.status === "completed"}
                onChange={(e) => setMaintenanceForm((f) => ({ ...f, assignedTechnician: e.target.value }))}
                sinhalaTyping
              />
              <InputField
                label={t("inventory.colMaintenanceType")}
                type="select"
                value={maintenanceForm.maintenanceType}
                onChange={(e) => setMaintenanceForm((f) => ({ ...f, maintenanceType: e.target.value }))}
                options={["Repair", "Inspection", "Cleaning", "Part Replacement", "Overhaul", "Other"].map((v) => ({ value: v, label: v }))}
              />
              <div className="field-full">
                <InputField
                  label={t("inventory.colRemarks")}
                  type="textarea"
                  rows={2}
                  value={maintenanceForm.remarks}
                  readOnly={managingRecord.status === "completed"}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, remarks: e.target.value }))}
                  voiceInput
                  sinhalaTyping
                />
              </div>
            </div>

            <h3 className="section-label">{t("inventory.partsUsed")}</h3>
            {managingRecord.partsCost && (
              <p className="inventory-pending-note">
                {t("inventory.earlierPartsNote")}: {managingRecord.partsCost}
              </p>
            )}
            <MaintenancePartsEditor
              rows={maintenanceForm.parts}
              onChange={(parts) => setMaintenanceForm((f) => ({ ...f, parts }))}
              readOnly={managingRecord.status === "completed" || !canManage}
            />

            {managingRecord.status === "in_progress" && (
              <>
                <h3 className="section-label">{t("inventory.finalInspectionTitle")}</h3>
                <div className="modal-form-grid">
                  <InputField
                    label={t("inventory.finalCondition")}
                    type="select"
                    value={maintenanceForm.finalCondition}
                    onChange={(e) => setMaintenanceForm((f) => ({ ...f, finalCondition: e.target.value }))}
                    options={[
                      { value: "good", label: t("status.good") },
                      { value: "damaged", label: t("status.damaged") },
                    ]}
                  />
                  <InputField
                    label={t("inventory.finalInspectionResult")}
                    type="select"
                    required
                    value={maintenanceForm.finalInspectionPassed}
                    onChange={(e) => setMaintenanceForm((f) => ({ ...f, finalInspectionPassed: e.target.value }))}
                    placeholder={t("inventory.selectResult")}
                    options={[
                      { value: "pass", label: t("inventory.inspectionPassed") },
                      { value: "fail", label: t("inventory.inspectionFailed") },
                    ]}
                  />
                </div>
                <p className="inventory-pending-note">{t("inventory.finalInspectionNote")}</p>
              </>
            )}

            {managingRecord.status === "completed" && (
              <div className="inventory-maintenance-summary">
                <p><strong>{t("inventory.finalCondition")}:</strong> {managingRecord.finalCondition ? <Badge status={managingRecord.finalCondition} /> : "—"}</p>
                <p><strong>{t("inventory.finalInspectionResult")}:</strong> {managingRecord.finalInspectionPassed ? t("inventory.inspectionPassed") : t("inventory.inspectionFailed")}</p>
                <p><strong>{t("inventory.colCompletionDate")}:</strong> {formatDate(managingRecord.completionDate)}</p>
                {managingRecord.returnedToStockAt && (
                  <>
                    <p><strong>{t("inventory.returnedToStock")}:</strong> {formatDateTime(managingRecord.returnedToStockAt)}</p>
                    <p>
                      <strong>{t("inventory.returnedToStockBy")}:</strong>{" "}
                      {managingRecord.returnedToStockBy?.fullName || managingRecord.returnedToStockBy?.rankAndNumber || "—"}
                    </p>
                  </>
                )}
              </div>
            )}

            {isAwaitingStock(managingRecord) && canManage && (
              <>
                <h3 className="section-label">{t("inventory.returnToStockTitle")}</h3>
                <p className="inventory-pending-note">{t("inventory.returnToStockText")}</p>
                <InputField
                  label={t("inventory.colStorageLocation")}
                  type="select"
                  required
                  value={maintenanceForm.stockLocation}
                  placeholder={t("inventory.selectStorageLocation")}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, stockLocation: e.target.value }))}
                  options={STORAGE_LOCATIONS.map((loc) => ({ value: loc, label: loc }))}
                />
              </>
            )}
          </>
        )}
        {maintenanceError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{maintenanceError}</p>}
      </Modal>

      <Modal
        open={Boolean(inspectingItem)}
        onClose={closeInspect}
        title={inspectingItem ? `${t("inventory.inspectWeapon")} — ${inspectingItem.itemId}` : ""}
        footer={
          <Button variant="primary" fullWidth onClick={handleInspectionSubmit} disabled={inspectionSubmitting}>
            {inspectionSubmitting ? t("inventory.processing") : t("inventory.recordInspection")}
          </Button>
        }
      >
        {inspectingItem && inspectionForm && (
          <>
            <div className="inventory-maintenance-summary">
              <p><strong>{t("inventory.colItemId")}:</strong> {inspectingItem.itemId}</p>
              <p><strong>{t("inventory.colItemName")}:</strong> {inspectingItem.itemName}</p>
              <p><strong>{t("inventory.colLastInspection")}:</strong> {inspectingItem.lastInspectionDate ? formatDate(inspectingItem.lastInspectionDate) : "—"}</p>
            </div>

            <div className="modal-form-grid">
              <InputField
                label={t("inventory.colInspectionType")}
                type="select"
                value={inspectionForm.inspectionType}
                onChange={(e) => setInspectionForm((f) => ({ ...f, inspectionType: e.target.value }))}
                options={["Scheduled", "Random", "Post-Maintenance", "Other"].map((v) => ({ value: v, label: v }))}
              />
              <InputField
                label={t("inventory.colCondition")}
                type="select"
                value={inspectionForm.condition}
                onChange={(e) => setInspectionForm((f) => ({ ...f, condition: e.target.value }))}
                options={[
                  { value: "good", label: t("status.good") },
                  { value: "damaged", label: t("status.damaged") },
                ]}
              />
              <div className="field-full">
                <InputField
                  label={t("inventory.findings")}
                  type="textarea"
                  rows={2}
                  value={inspectionForm.findings}
                  onChange={(e) => setInspectionForm((f) => ({ ...f, findings: e.target.value }))}
                  placeholder={t("inventory.findingsPlaceholder")}
                  voiceInput
                  sinhalaTyping
                />
              </div>
              <div className="field-full">
                <InputField
                  label={t("inventory.damageIssues")}
                  type="textarea"
                  rows={2}
                  value={inspectionForm.damageIssues}
                  onChange={(e) => setInspectionForm((f) => ({ ...f, damageIssues: e.target.value }))}
                  placeholder={t("inventory.damageIssuesPlaceholder")}
                  voiceInput
                  sinhalaTyping
                />
              </div>
              <InputField
                label={t("inventory.accessoriesChecked")}
                value={inspectionForm.accessoriesChecked}
                onChange={(e) => setInspectionForm((f) => ({ ...f, accessoriesChecked: e.target.value }))}
                placeholder={t("inventory.accessoriesCheckedPlaceholder")}
                sinhalaTyping
              />
              <InputField
                label={t("inventory.colResult")}
                type="select"
                required
                value={inspectionForm.result}
                onChange={(e) => setInspectionForm((f) => ({ ...f, result: e.target.value }))}
                placeholder={t("inventory.selectResult")}
                options={[
                  { value: "passed", label: t("inventory.inspectionPassed") },
                  { value: "failed", label: t("inventory.inspectionFailed") },
                ]}
              />
              <div className="field-full">
                <InputField
                  label={t("inventory.colRemarks")}
                  type="textarea"
                  rows={2}
                  value={inspectionForm.remarks}
                  onChange={(e) => setInspectionForm((f) => ({ ...f, remarks: e.target.value }))}
                  voiceInput
                  sinhalaTyping
                />
              </div>
            </div>

            {inspectionForm.result === "failed" && (
              <p className="inventory-pending-note">{t("inventory.inspectionFailedNote")}</p>
            )}
          </>
        )}
        {inspectionError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{inspectionError}</p>}
      </Modal>

      <Modal
        open={Boolean(reportingMissingItem)}
        onClose={closeReportMissing}
        title={reportingMissingItem ? `${t("inventory.reportMissing")} — ${reportingMissingItem.itemId}` : ""}
        footer={
          <Button variant="primary" fullWidth onClick={handleReportMissingSubmit} disabled={missingSubmitting}>
            {missingSubmitting ? t("inventory.processing") : t("inventory.confirmReportMissing")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("inventory.reportMissingText")}
        </p>
        <InputField
          label={t("inventory.colRemarks")}
          type="textarea"
          rows={3}
          value={missingRemarks}
          onChange={(e) => setMissingRemarks(e.target.value)}
          placeholder={t("inventory.reportMissingPlaceholder")}
          voiceInput
          sinhalaTyping
        />
        {missingError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{missingError}</p>}
      </Modal>
    </div>
  );
}
