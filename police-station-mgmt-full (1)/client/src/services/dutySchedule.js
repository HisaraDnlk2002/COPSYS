import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { dummyDutySchedule } from "./dummyData";

export async function getMySchedule() {
  if (USE_DUMMY_DATA) {
    const uid = localStorage.getItem("dummyUserId");
    return Promise.resolve(dummyDutySchedule.filter((d) => d.officerId === uid));
  }
  return api.get("/duty-schedule/mine");
}
