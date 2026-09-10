import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import {
  dummyInventoryStats,
  dummyInventoryItems,
  dummyIssueTransactions,
  dummyReturnTransactions,
  dummyDamagedRecords,
} from "./dummyData";

// GET /api/inventory/my-weapons — the caller's own currently-assigned
// firearm(s) plus their own recent weapon custody history. Available to
// every role (not just duty_officer/inventory_officer, unlike the rest
// of this file) since it's scoped server-side to the logged-in officer.
export async function getMyWeapons() {
  if (USE_DUMMY_DATA) {
    // The dummy dataset has no per-officer scoping (transactions only
    // carry a display name, not an id to filter on), so this is a
    // best-effort stand-in rather than a true "my records" view.
    const firearms = dummyInventoryItems.filter((i) => i.category === "Firearms");
    return Promise.resolve({
      assigned: firearms.filter((i) => i.status === "Available"),
      history: [...dummyIssueTransactions, ...dummyReturnTransactions].filter((t) =>
        firearms.some((i) => i.itemId === t.itemId)
      ),
      pendingConfirmation: [],
    });
  }
  return api.get("/inventory/my-weapons");
}

// PATCH /api/inventory/transactions/:id/confirm — the officer named on
// the transaction confirming their side of it: receipt for an issue, or
// that they actually handed the weapon back for a return/damaged
// report. remarks is optional. See confirmTransaction in
// inventoryController.js for what each type does on confirm.
export async function confirmTransaction(transactionId, remarks) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({
      id: transactionId,
      confirmationStatus: "secured",
      confirmedAt: new Date().toISOString(),
      confirmationRemarks: remarks || null,
    });
  }
  return api.patch(`/inventory/transactions/${transactionId}/confirm`, { remarks });
}

export async function getInventoryStats() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyInventoryStats);
  }
  // Real backend doesn't have a dedicated stats endpoint yet — derive
  // from the item list once connected, or add one if it's worth it.
  return api.get("/inventory/stats");
}

export async function getInventoryItems() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyInventoryItems);
  }
  return api.get("/inventory");
}

export async function getIssueTransactions() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyIssueTransactions);
  }
  return api.get("/inventory/transactions?type=issue");
}

export async function getReturnTransactions() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyReturnTransactions);
  }
  return api.get("/inventory/transactions?type=return");
}

export async function getDamagedRecords() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyDamagedRecords);
  }
  // NOTE: was querying ?type=return&condition=damaged — the backend only
  // ever reads the `type` param (condition was silently ignored), so this
  // was fetching every return, not just faulty ones. returnItem() in
  // inventoryController.js already tags a faulty return with its own
  // type: "damaged" at creation time; that's the correct filter.
  return api.get("/inventory/transactions?type=damaged");
}

export async function addInventoryItem(payload) {
  if (USE_DUMMY_DATA) {
    const newItem = {
      id: `i${dummyInventoryItems.length + 1}`,
      status: "Available",
      condition: "good",
      ...payload,
    };
    dummyInventoryItems.unshift(newItem);
    return Promise.resolve(newItem);
  }
  return api.post("/inventory", payload);
}

export async function issueItem(itemId, payload) {
  if (USE_DUMMY_DATA) {
    const newTransaction = {
      id: `t${dummyIssueTransactions.length + 1}`,
      itemId,
      status: "In Field",
      ...payload,
    };
    dummyIssueTransactions.unshift(newTransaction);
    return Promise.resolve(newTransaction);
  }
  return api.post(`/inventory/${itemId}/issue`, payload);
}

export async function returnItem(itemId, payload) {
  if (USE_DUMMY_DATA) {
    const newReturn = {
      id: `r${dummyReturnTransactions.length + 1}`,
      itemId,
      ...payload,
    };
    dummyReturnTransactions.unshift(newReturn);
    return Promise.resolve(newReturn);
  }
  return api.post(`/inventory/${itemId}/return`, payload);
}

// POST /api/inventory/:id/report-missing — inventory_officer only.
// Raises a Critical "Weapon Reported Missing" alert and blocks the item
// from being issued until it's manually cleared.
export async function reportMissing(itemId, remarks) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id: itemId, status: "missing" });
  }
  return api.post(`/inventory/${itemId}/report-missing`, { remarks });
}
