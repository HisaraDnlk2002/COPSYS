// Stand-in data shaped EXACTLY like the real API responses will be
// (per ARCHITECTURE.md Section 2/3 — field names won't change when the
// real backend lands, only where the data comes from).
//
// Swap USE_DUMMY_DATA to false in services/config.js once MongoDB is
// connected and the real endpoints are tested.

export const dummyUsers = [
  { id: "u1", fullName: "Sgt. Bandara", rankAndNumber: "77412", department: "Administration", role: "admin", status: "active" },
  { id: "u2", fullName: "Insp. Wijesinghe", rankAndNumber: "88214", department: "Command", role: "oic", status: "active" },
  { id: "u3", fullName: "PC Perera", rankAndNumber: "91022", department: "Traffic Control", role: "duty_officer", status: "active" },
  { id: "u4", fullName: "WPC Silva", rankAndNumber: "73310", department: "Stores", role: "inventory_officer", status: "active" },
  { id: "u5", fullName: "PC Nishadi", rankAndNumber: "65521", department: "Crime", role: "officer", status: "active" },
  { id: "u6", fullName: "WPC Silva", rankAndNumber: "98201", department: "Traffic Control", role: "officer", status: "active" },
  { id: "u7", fullName: "Insp. Kamal", rankAndNumber: "77001", department: "Traffic Control", role: "officer", status: "active" },
  { id: "u8", fullName: "Sgt. Perera", rankAndNumber: "88331", department: "Traffic Control", role: "officer", status: "disabled" },
  { id: "u9", fullName: "WPC Jayamaha", rankAndNumber: "99440", department: "Traffic Control", role: "officer", status: "active" },
];


// Maps a username (rank-and-number) to a dummy "logged in" user.
export const dummyCredentials = {
  77412: { password: "admin123", userId: "u1" },
  88214: { password: "oic123", userId: "u2" },
  91022: { password: "duty123", userId: "u3" },
  73310: { password: "inv123", userId: "u4" },
  65521: { password: "officer123", userId: "u5" },
};

// Matches the leave balance numbers shown across the PDF's workflows
// (20/12/5 days pattern seen on pages 3, 6, 12).
export const dummyLeaveBalances = {
  u1: { annual: 21, sick: 15, casual: 15 },
  u2: { annual: 21, sick: 15, casual: 15 },
  u3: { annual: 20, sick: 12, casual: 5 },
  u4: { annual: 20, sick: 15, casual: 15 },
  u5: { annual: 20, sick: 12, casual: 5 },
};

// Matches the LV-112/LV-132/LV-052/LV-012 rows seen on pages 3, 6, 12.
export const dummyLeaveRequests = [
  { id: "lv1", refId: "LV-112", officerId: "u5", officerName: "PC Nishadi", leaveType: "annual", startDate: "2026-03-04", endDate: "2026-03-06", days: 2, status: "pending", remarks: "Home Renovation" },
  { id: "lv2", refId: "LV-132", officerId: "u5", officerName: "PC Nishadi", leaveType: "sick", startDate: "2026-02-01", endDate: "2026-02-06", days: 5, status: "approved", remarks: "Seasonal Influenza" },
  { id: "lv3", refId: "LV-052", officerId: "u5", officerName: "PC Nishadi", leaveType: "annual", startDate: "2025-12-04", endDate: "2025-12-06", days: 2, status: "approved", remarks: "Trip" },
  { id: "lv4", refId: "LV-012", officerId: "u5", officerName: "PC Nishadi", leaveType: "casual", startDate: "2025-03-08", endDate: "2025-03-16", days: 8, status: "approved", remarks: "Family Gathering" },
  { id: "lv5", refId: "LV-201", officerId: "u3", officerName: "PC Perera", leaveType: "annual", startDate: "2026-10-12", endDate: "2026-10-15", days: 4, status: "pending", remarks: "Personal" },
];

// "My assigned complaints" table from the Officer Dashboard (page 2):
// Case ID / Incident Type / Reported Date / Status.
export const dummyComplaints = [
  { id: "c1", refId: "CMP-8821", fullName: "Nimal Fernando", nic: "851234567V", contactNumber: "0771234567", category: "Residential Burglary", dateOfIncident: "2024-05-18", description: "Break-in reported at residence on Galle Road.", status: "investigating", severity: "normal", assignedOfficerId: "u5", registeredBy: "u5" },
  { id: "c2", refId: "CMP-8845", fullName: "Kamala Silva", nic: "902345678V", contactNumber: "0712345678", category: "Public Disturbance", dateOfIncident: "2024-05-20", description: "Noise complaint and altercation outside a shop.", status: "open", severity: "normal", assignedOfficerId: "u5", registeredBy: "u3" },
  { id: "c3", refId: "CMP-8910", fullName: "Ruwan Jayasuriya", nic: "881122334V", contactNumber: "0701122334", category: "Vehicle Theft", dateOfIncident: "2025-05-20", description: "Motorcycle reported stolen from parking area.", status: "closed", severity: "normal", assignedOfficerId: "u5", registeredBy: "u5" },
  { id: "c4", refId: "CMP-8911", fullName: "Anusha Perera", nic: "934455667V", contactNumber: "0759988776", category: "Residential Burglary", dateOfIncident: "2024-05-20", description: "Second burglary report, same neighbourhood as CMP-8821.", status: "closed", severity: "normal", assignedOfficerId: "u5", registeredBy: "u5" },
  { id: "c5", refId: "CMP-2003-890", fullName: "Saman Kumara", nic: "771234567V", contactNumber: "0772223344", category: "Theft", dateOfIncident: "2026-06-01", description: "Shop theft reported.", status: "open", severity: "normal", assignedOfficerId: null, registeredBy: "u3" },
  { id: "c6", refId: "CMP-2023-891", fullName: "Dilani Rajapaksha", nic: "885566778V", contactNumber: "0763334455", category: "Assault", dateOfIncident: "2026-06-02", description: "Physical altercation reported between neighbours.", status: "investigating", severity: "normal", assignedOfficerId: "u3", registeredBy: "u2" },
  { id: "c7", refId: "CMP-2023-892", fullName: "Mahesh Bandara", nic: "799887766V", contactNumber: "0754445566", category: "Public Nuisance", dateOfIncident: "2026-06-03", description: "Repeated public nuisance complaints in same area.", status: "open", severity: "normal", assignedOfficerId: null, registeredBy: "u3" },
  { id: "c8", refId: "CMP-2023-893", fullName: "Chathura Wijesinghe", nic: "812233445V", contactNumber: "0745566778", category: "Traffic", dateOfIncident: "2026-06-04", description: "Hit and run reported near junction.", status: "open", severity: "normal", assignedOfficerId: "u5", registeredBy: "u5" },
  { id: "c9", refId: "CMP-2023-894", fullName: "Tharindu Silva", nic: "823344556V", contactNumber: "0736677889", category: "Missing Person", dateOfIncident: "2026-06-05", description: "Family member reported missing for 24 hours.", status: "open", severity: "critical", assignedOfficerId: null, registeredBy: "u2" },
];

// Weekly Duty Schedule table from the Officer Dashboard (pages 2, 7, 11).
export const dummyDutySchedule = [
  { id: "d1", officerId: "u5", day: "Monday", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "d2", officerId: "u5", day: "Tuesday", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "d3", officerId: "u5", day: "Wednesday", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "d4", officerId: "u5", day: "Friday", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "pending" },
  { id: "d5", officerId: "u3", day: "Monday", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "d6", officerId: "u3", day: "Tuesday", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "d7", officerId: "u3", day: "Wednesday", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "d8", officerId: "u3", day: "Friday", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "pending" },
];

// Stat card values for the dashboard (Today's Duty / Leave Status /
// Assigned Complaints / Next Shift) — varies per role per the PDF.
export const dummyDashboardStats = {
  u1: { todaysDuty: "Administration", todaysDutyShift: "06.00 -18.00", nextShift: "Tomorrow", nextShiftTime: "06.00 -18.00", activeComplaints: 5 },
  u2: { todaysDuty: "Command", todaysDutyShift: "08.00 -18.00", nextShift: "Tomorrow", nextShiftTime: "08.00 -18.00", activeComplaints: 24 },
  u3: { todaysDuty: "Administration", todaysDutyShift: "06.00 -18.00", nextShift: "Tomorrow", nextShiftTime: "06.00 -18.00", activeComplaints: 5 },
  u4: { todaysDuty: "Patrol", todaysDutyShift: "06.00 -18.00", nextShift: "Tomorrow", nextShiftTime: "06.00 -18.00", activeComplaints: 0 },
  u5: { todaysDuty: "Patrol", todaysDutyShift: "06.00 -18.00", nextShift: "Tomorrow", nextShiftTime: "06.00 -18.00", activeComplaints: 5 },
};

// Inventory Dashboard stat cards (page 8): Total Assets 44, Issued Items
// 12, Available Stock 32, Damaged/Repairs 2.
export const dummyInventoryStats = {
  totalAssets: 44,
  issuedItems: 12,
  availableStock: 32,
  damagedRepairs: 2,
  stationLabel: "Western Province District 04",
};

// Equipment Inventory Ledger — "Weapon Details" tab (page 8).
export const dummyInventoryItems = [
  { id: "i1", itemId: "WP-8821", itemName: "Type-56 Assault Rifle", category: "Firearms", quantity: 24, condition: "good", status: "Available" },
  { id: "i2", itemId: "EQ-1092", itemName: "Motorola Handheld Radio", category: "Electronics", quantity: 12, condition: "good", status: "Available" },
  { id: "i3", itemId: "WP-8830", itemName: "Tear Gas Canister", category: "Safety Gear", quantity: 8, condition: "good", status: "Available" },
];

// Equipment Issuing Log — "Issue records" tab (page 8).
export const dummyIssueTransactions = [
  { id: "t1", itemId: "WP-8821", officerName: "SGT. Bandara", dutyType: "Patrol", dateTime: "10.30", status: "In Field" },
  { id: "t2", itemId: "EQ-1092", officerName: "PC. Perera", dutyType: "Traffic", dateTime: "10.50", status: "In Field" },
  { id: "t3", itemId: "WP-8821", officerName: "SGT. Bandara", dutyType: "Patrol", dateTime: "15.00", status: "In Field" },
  { id: "t4", itemId: "EQ-1092", officerName: "PC. Perera", dutyType: "Patrol", dateTime: "16.00", status: "In Field" },
];

// Equipment Returned Log — "Return Records" tab (page 8).
export const dummyReturnTransactions = [
  { id: "r1", itemId: "WP-8821", officerName: "SGT. Bandara", dutyType: "Patrol", dateTime: "18.00", condition: "Good", remarks: "Cleaned" },
  { id: "r2", itemId: "EQ-1092", officerName: "PC. Perera", dutyType: "Traffic", dateTime: "18.00", condition: "Good", remarks: "Cleaned" },
  { id: "r3", itemId: "WP-8821", officerName: "SGT. Bandara", dutyType: "Patrol", dateTime: "12.00", condition: "Faulty", remarks: "Trigger sticky" },
  { id: "r4", itemId: "EQ-1092", officerName: "PC. Perera", dutyType: "Patrol", dateTime: "08.00", condition: "Good", remarks: "Cleaned" },
];

// "Damaged Records" tab — derived view, filtering returns where
// condition is not "Good". Kept as its own export so the page doesn't
// need to know this derivation rule.
export const dummyDamagedRecords = dummyReturnTransactions.filter((r) => r.condition !== "Good");

// --- Duty Roster (TEMPORARY dummy data — replaced by real MongoDB
// queries once USE_DUMMY_DATA is false. The roster PAGE and the backend
// ALLOCATION ENGINE are real/permanent; only these sample records are
// throwaway placeholders so the screen has something to render.) ---

// A few extra officers purely so the weekly grid has enough rows to be
// meaningful. In the real system this comes from the full personnel list.
export const dummyRosterOfficers = [
  { id: "u3", fullName: "PC Perera", rankAndNumber: "PC 91022", department: "Traffic Control" },
  { id: "u5", fullName: "PC Nishadi", rankAndNumber: "PC 65521", department: "Traffic Control" },
  { id: "u6", fullName: "WPC Silva", rankAndNumber: "WPC 98201", department: "Traffic Control" },
  { id: "u7", fullName: "Insp. Kamal", rankAndNumber: "Insp 77412", department: "Traffic Control" },
  { id: "u8", fullName: "Sgt. Perera", rankAndNumber: "Sgt 88331", department: "Traffic Control" },
  { id: "u9", fullName: "WPC Jayamaha", rankAndNumber: "WPC 99440", department: "Traffic Control" },
];

export const dummyRosterWeeks = [
  {
    id: "w1",
    weekStarting: "2026-06-22",
    department: "Traffic Control",
    requiredStaffing: 5,
    specialEvents: "",
    status: "draft",
    scheduledUnits: 5,
    offDuty: 8,
    leaveCoverage: 5,
  },
  {
    id: "w2",
    weekStarting: "2026-06-15",
    department: "Traffic Control",
    requiredStaffing: 5,
    specialEvents: "",
    status: "approved",
    scheduledUnits: 5,
    offDuty: 8,
    leaveCoverage: 5,
  },
];

// Shift cells for week "w1" (the active/draft week) — matches the
// Mon-Sun grid look from the spec (officer rows, day columns, P/L/T codes).
export const dummyRosterShifts = [
  { id: "s1", weekId: "w1", officerId: "u3", date: "2026-06-22", day: "Mon", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "s2", weekId: "w1", officerId: "u3", date: "2026-06-23", day: "Tue", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "s3", weekId: "w1", officerId: "u5", date: "2026-06-22", day: "Mon", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "s4", weekId: "w1", officerId: "u6", date: "2026-06-22", day: "Mon", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "pending" },
  { id: "s5", weekId: "w1", officerId: "u7", date: "2026-06-22", day: "Mon", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "s6", weekId: "w1", officerId: "u8", date: "2026-06-22", day: "Mon", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
  { id: "s7", weekId: "w1", officerId: "u9", date: "2026-06-22", day: "Mon", shiftStart: "08:00", shiftEnd: "16:00", department: "Traffic Control", status: "confirmed" },
];

// --- OIC Command Dashboard (page 13) — TEMPORARY dummy data. ---
// Stat cards: Total Officers, Pending Leaves, Active Complaints, Today's Duties.
export const dummyOicStats = {
  totalOfficers: 142,
  pendingLeaves: 8,
  activeComplaints: 24,
  activeComplaintsCaption: "All departments above 70%",
  todaysDuties: 58,
  todaysDutiesCaption: "Normal operational capacity",
  currentStationStrength: "90%",
};

// Personnel & User Management stat cards (page 6): Total Personnel,
// Active System Users, Pending Approves, Disabled Accounts.
export const dummyPersonnelStats = {
  totalPersonnel: 70,
  activeSystemUsers: 66,
  pendingApproves: 4,
  disabledAccounts: 12,
};
// --- Reports & Analytics Dashboard (page 16) — TEMPORARY dummy data. ---
export const dummyReportsSummary = {
  dutyCompliancePercent: 94.2,
  dutyComplianceCaption: "Monthly Personnel attendance and roster shifts",
  leaveStatisticsDays: 128,
  leaveStatisticsCaption: "Year-to-date officer utilization leave rates",
  inventoryMovements: 42,
  inventoryMovementsCaption: "Resource allocation and supply chain logs",
};

// Bar chart: "Crime Incidence Distribution" — breakdown by major
// offense categories over the last 5 months.
export const dummyCrimeDistribution = [
  { category: "Theft", count: 38 },
  { category: "Assault", count: 22 },
  { category: "Traffic", count: 51 },
];

// Line chart: "Weekly Force Strength" — active duty vs on-leave
// personnel across the last 7 days.
export const dummyForceStrength = [
  { date: "Mon", activeDuty: 134, onLeave: 8 },
  { date: "Tue", activeDuty: 130, onLeave: 12 },
  { date: "Wed", activeDuty: 136, onLeave: 6 },
  { date: "Thu", activeDuty: 128, onLeave: 14 },
  { date: "Fri", activeDuty: 138, onLeave: 4 },
  { date: "Sat", activeDuty: 140, onLeave: 2 },
  { date: "Sun", activeDuty: 133, onLeave: 9 },
];

// "Recent Activity Logs" table — official PDF/CSV reports ready for download.
export const dummyActivityLog = [
  { id: "log1", reportTitle: "Quarterly Crime Statistics-01", type: "crime", generatedBy: "Insp. Pathirana", date: "2026-03-05", status: "Complete" },
  { id: "log2", reportTitle: "Monthly Personnel Leave Audit", type: "leave", generatedBy: "PC. Perera", date: "2026-05-11", status: "Complete" },
  { id: "log3", reportTitle: "Monthly Personnel Leave Audit", type: "Duty", generatedBy: "PC. Kumar", date: "2026-02-27", status: "Archived" },
];

// Sidebar sections on the Reports page (page 16): grouped report shortcuts.
export const dummyReportEngineSections = [
  { group: "Operations", items: ["Duty Compliance", "Leave Summary", "Inventory Audit", "Financial Logs"] },
  { group: "Investigations", items: ["Criminal Investigation", "Traffic Division"] },
  { group: "Administration", items: ["Admin & HR", "Logistics"] },
];
// --- System Settings / RBAC (page 15) — TEMPORARY dummy data. ---
// Matches server/src/models/SystemSettings.js exactly so the dummy and
// real shapes line up when MongoDB is connected.
export const dummySystemSettings = {
  id: "settings1",
  smsNotificationsEnabled: true,
  emailDispatchEnabled: true,
  criticalComplaintThreshold: 4, // 1-5 scale, "only level 4+ triggers emergency SMS"
  rbac: {
    leaveApprovals: { chiefInspector: true, inspectorOIC: true, sergeant: false, constable: false },
    complaintRegistry: { chiefInspector: true, inspectorOIC: true, sergeant: true, constable: false },
    inventoryIssues: { chiefInspector: true, inspectorOIC: true, sergeant: true, constable: false },
    dutyRosterPublish: { chiefInspector: true, inspectorOIC: true, sergeant: false, constable: false },
    systemReports: { chiefInspector: true, inspectorOIC: false, sergeant: false, constable: false },
  },
};