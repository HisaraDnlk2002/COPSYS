import { useAuth } from "../../auth/useAuth";
import { DashboardPage } from "./Dashboard";
import { OicDashboardPage } from "../OicDashboard/OicDashboard";
import { DutyOfficerBriefingPage } from "../DutyOfficerBriefing/DutyOfficerBriefing";

// The "/dashboard" route renders different content per role, but stays
// a single route so links, nav, and redirects don't need to know which
// variant to point at — they always go to "/dashboard".
export function DashboardRouter() {
  const { user } = useAuth();

  if (user?.role === "oic") {
    return <OicDashboardPage />;
  }

  if (user?.role === "duty_officer") {
    return <DutyOfficerBriefingPage />;
  }

  return <DashboardPage />;
}