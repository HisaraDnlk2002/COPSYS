import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import {
  dummyInventoryStats,
  dummyInventoryItems,
  dummyIssueTransactions,
  dummyReturnTransactions,
  dummyDamagedRecords,
} from "./dummyData";

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
  return api.get("/inventory/transactions?type=return&condition=damaged");
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
