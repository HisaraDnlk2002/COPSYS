import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { dummySystemSettings } from "./dummyData";

export async function getSettings() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(JSON.parse(JSON.stringify(dummySystemSettings)));
  }
  return api.get("/settings");
}

export async function updateSettings(payload) {
  if (USE_DUMMY_DATA) {
    Object.assign(dummySystemSettings, payload);
    return Promise.resolve(dummySystemSettings);
  }
  return api.patch("/settings", payload);
}