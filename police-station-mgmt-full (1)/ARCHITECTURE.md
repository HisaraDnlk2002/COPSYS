# COPSYS: Centralized Police Operations System — Architecture

> Built to match the Task 4 High-Fidelity Prototype (Figma workflows 1-5).
> This is the authoritative spec - when the Figma and this doc disagree,
> the Figma wins and this doc gets corrected, not the other way round.

Stack: **React (frontend) + Node/Express (API) + MongoDB (database) + JWT (auth)**

---

## 1. Roles & Permissions Matrix

Six roles total. **OIC sits at the top** of day-to-day station operations
(command dashboard, approvals, reports, RBAC settings). **Admin is a
separate, narrower role** focused on personnel account provisioning -
not "above" OIC, just a different concern.

| Feature | Admin | OIC | Duty Officer | Inventory Officer | Officer |
|---|---|---|---|---|---|
| View own dashboard | Yes | Yes (command view) | Yes | Yes | Yes |
| Apply leave | Yes | Yes | Yes | Yes | Yes |
| Approve/reject leave | No | Yes | No | No | No |
| Register complaint | No | Yes | Yes | No | Yes |
| View/manage all complaints (registry + log) | No | Yes | Yes (own station) | No | No |
| Personnel & User Management | Yes | No | No | No | No |
| Inventory module | No | No | View only | Full access (issue/return/add) | No |
| Create/edit weekly duty roster | No | Yes (generate, approve, send-back) | Yes (manual entry / primary author) | No | No |
| Reports & Analytics | No | Yes | No | No | No |
| System Settings / RBAC | No | Yes | No | No | No |

This matrix is the source of truth - every route guard and UI nav item
maps back to a row here. When you add a feature, add a row first.

**Notes on the two ambiguous cases from the Figma:**
- **Inventory** appears under a "Duty Officer" account in workflow 3 of
  the Figma demo (header reads "Insp. Wijesinghe / Duty Officer"). We're
  keeping **Inventory Officer as its own real role** regardless - the
  demo account was just the one logged in when that screen was recorded,
  not evidence the permission belongs to Duty Officer specifically. Duty
  Officer keeps inventory access too, since that's literally what's
  pictured, but Inventory Officer remains the primary/intended owner.
- **OIC absorbed System Settings/RBAC** (Figma page 15) and Reports &
  Analytics (Figma page 16) - these weren't in our original plan, added
  per this spec.

**Left nav per role:**
- **Admin:** Dashboard, Personnel & User Management
- **OIC:** Dashboard, Leave Management, Duty Roster, Complaint Registry, Complaint Log, Reports, Settings
- **Duty Officer:** Dashboard, Duty Roster, Inventory, Leave Requests, Complaints & Logs (workflows 3 and 4 both say "Duty Officer" but show slightly different sidebars - treat as one role with the combined nav)
- **Inventory Officer:** Dashboard, Inventory, Leave Requests
- **Officer:** Dashboard, Leave Requests, Complaints Registry

---

## 2. Dashboard Specs Per Role

Matches the actual stat cards / tables seen in each workflow screenshot.

**Officer Dashboard** (workflows 1 & 2):
- Stat cards: Today's Duty, Leave Status (available balance), Assigned
  Complaints (active investigations count), Next Shift
- Weekly Duty Schedule table: Day / Shift Timing / Assign Department / Status
- "My assigned complaints" table: Case ID / Incident Type / Reported Date / Status, with "View All" link

**Duty Officer Dashboard** (workflows 3 & 4):
- Same stat cards as Officer, header shows officer name + "Duty Officer" rank label
- Weekly Duty Schedule table (read view on dashboard; full edit on Duty Roster page)

**OIC Command Dashboard** (workflow 5):
- Stat cards: Total Officers, Pending Leaves, Active Complaints, Today's Duties (each with a small icon)
- "Personnel Leave Requests" table: Officer/Rank, Dates, Type, Actions (approve / reject / view) - inline actions, not a separate page navigation
- "Incident & Complaint Monitor" table: Complaint ID / Nature / Status (badge: Unassigned / In-Progress / Resolved / Critical) / Assignment, with an "Assign" button per row and an "X Unassigned" counter badge top-right of the panel

---

## 3. Data Model (MongoDB / Mongoose)

```
User
  fullName: string
  rankAndNumber: string         // also login username
  department: string
  role: "admin" | "oic" | "duty_officer" | "inventory_officer" | "officer"
  status: "active" | "disabled" | "pending"
  passwordHash: string
  stationId: string

LeaveBalance
  officerId: ref User
  annual: number  (default 21)
  sick: number    (default 15)
  casual: number  (default 15)
  year: number

LeaveRequest
  refId: string                 // "LV-112"
  officerId: ref User
  officerName: string            // denormalized for table display
  leaveType: "annual" | "sick" | "casual"
  startDate, endDate: date
  days: number
  justification: string          // required, >=30 words, if annual leave >5 days
  actingOfficerId: ref User | null
  emergencyContact: string
  status: "pending" | "approved" | "rejected"
  reviewedBy: ref User | null
  reviewedAt: date | null
  remarks: string
  stationId: string

Complaint
  refId: string                  // "CMP-001"
  complainant: { fullName, nic, contactNumber, occupation, address }
  category: string
  dateOfIncident: date
  description: string
  status: "open" | "investigating" | "closed"   // shown to OIC as Unassigned/In-Progress/Resolved
  severity: "normal" | "critical"   // drives the red "Critical" badge on OIC's monitor table, independent of status
  assignedOfficerId: ref User | null
  registeredBy: ref User
  stationId: string

DutySchedule
  weekId: ref DutyRosterWeek        // which week this shift cell belongs to
  officerId: ref User
  date: date
  shiftStart, shiftEnd: string    // "08:00"
  department: string
  status: string                  // free-form short code for now (P/L/T seen on page 14's grid)
  stationId: string
  createdBy: ref User             // Duty Officer who authored it
  lastModifiedBy: ref User | null

DutyRosterWeek                    // the week-level record — separate from individual shift cells
  weekStarting: date              // Monday of the week
  department: string
  shiftPattern: string            // "Optimal" / "Reserve" etc, from the generation tool
  status: "draft" | "submitted" | "approved" | "sent_back"
  scheduledUnits, offDuty, leaveCoverage: number   // page 14 footer stats
  createdBy: ref User             // Duty Officer
  reviewedBy: ref User | null     // OIC
  reviewedAt: date | null
  sendBackReason: string
  stationId: string

InventoryItem
  itemId: string                  // "WP-8821" style
  itemName: string
  category: "Firearms" | "Electronics" | etc
  quantity: number
  status: "available" | "issued" | "damaged"
  stationId: string
  lastUpdatedBy: ref User

InventoryTransaction                // covers Issue / Return / Damaged logs (workflow 3, page 8-9)
  itemId: ref InventoryItem
  officerId: ref User              // who it was issued to / returned by
  type: "issue" | "return" | "damaged"
  dutyType: string                  // "Patrol", "Traffic" - shown in the issue/return log tables
  quantity: number
  dateTime: date
  condition: string | null          // "Good" / "Faulty" - only on return
  remarks: string | null
  stationId: string

SystemSettings                      // single doc per station, page 15
  stationId: string
  smsNotificationsEnabled: boolean
  emailDispatchEnabled: boolean
  criticalComplaintThreshold: number   // the alert-sensitivity slider
  rbac: {
    moduleName: { chiefInspector: bool, inspectorOIC: bool, sergeant: bool, constable: bool }
  }
```

---

## 4. API Routes

```
POST   /api/auth/login                          public

GET    /api/users/me                            any
GET    /api/users                                admin
POST   /api/users                                admin   (Register new Personnel)
PATCH  /api/users/:id/status                     admin

GET    /api/leave-requests/mine                  any
GET    /api/leave-requests                       oic     (approval queue - inline actions on OIC dashboard too)
POST   /api/leave-requests                       any
PATCH  /api/leave-requests/:id/approve           oic
PATCH  /api/leave-requests/:id/reject            oic
GET    /api/leave-balances/me                    any

GET    /api/complaints                           oic, duty_officer, officer (own-station registry)
GET    /api/complaints/log                        oic     (Complaint Log - broader history/audit view)
POST   /api/complaints                           oic, duty_officer, officer
PATCH  /api/complaints/:id                        oic, duty_officer   (status/assignment updates)
PATCH  /api/complaints/:id/assign                oic                  ("Assign" button on Incident Monitor)

GET    /api/duty-schedule/mine                   any
GET    /api/duty-schedule/weeks                  oic, duty_officer    (list roster weeks)
POST   /api/duty-schedule/weeks                  duty_officer          (roster generation tool)
GET    /api/duty-schedule/weeks/:weekId          oic, duty_officer    (full grid for one week)
PATCH  /api/duty-schedule/weeks/:weekId/submit   duty_officer          (send roster to OIC for approval)
PATCH  /api/duty-schedule/weeks/:weekId/approve  oic
PATCH  /api/duty-schedule/weeks/:weekId/send-back oic
POST   /api/duty-schedule                        duty_officer          (add one shift cell to a week)
PATCH  /api/duty-schedule/:id                     duty_officer, oic

GET    /api/inventory                            duty_officer, inventory_officer
POST   /api/inventory                            inventory_officer
PATCH  /api/inventory/:id                         duty_officer, inventory_officer
POST   /api/inventory/:id/issue                   duty_officer, inventory_officer
POST   /api/inventory/:id/return                  duty_officer, inventory_officer
GET    /api/inventory/transactions                duty_officer, inventory_officer  (Issue/Return/Damaged log tabs)

GET    /api/reports/summary                      oic    (Duty Compliance %, Leave Statistics, Inventory Movements)
GET    /api/reports/crime-distribution            oic    (bar chart data)
GET    /api/reports/force-strength                oic    (line chart data, last 7 days)
GET    /api/reports/activity-log                  oic    (placeholder - returns empty list, see open items)

GET    /api/settings                             oic
PATCH  /api/settings                             oic    (toggle SMS/Email, RBAC matrix, alert threshold)

GET    /api/dashboard/summary                    any    - role-appropriate cards
```

Every handler: **(1)** verify JWT -> uid + role, **(2)** check role against
the matrix in Section 1, **(3)** scope query to `stationId`, and for
non-management roles, to `officerId == uid` where relevant.

---

## 5. React App Structure

```
/src
  /services      - one file per resource; USE_DUMMY_DATA flag for dev without backend
  /auth          - AuthContext, ProtectedRoute
  /components    - Button, InputField, Card/StatCard, Table, Badge, Modal, Loader
                   (next additions: Chart wrapper for Reports, RosterGrid for the
                   Mon-Sun officer x day matrix on page 14)
  /layouts       - DashboardLayout (sidebar + topbar, nav driven by role)
  /pages
    /Login
    /Dashboard            - renders different content per role (see Section 2)
    /LeaveRequests        - apply form + history (Officer/Duty Officer/Inventory Officer view)
    /LeaveManagement       - OIC's approval queue (separate from LeaveRequests - has actions)
    /Complaints           - registration form + registry
    /ComplaintLog         - OIC only, audit/history view distinct from the registry
    /PersonnelManagement  - Admin only
    /DutyRoster           - roster generation tool + grid + approve/send-back (OIC, Duty Officer)
    /Inventory            - dashboard + Weapon Details/Issue/Return/Damaged tabs + 3 modals
    /Reports              - OIC only, stat cards + 2 charts + activity log table
    /Settings             - OIC only, RBAC matrix + notification toggles
  /config
    navConfig.js          - nav items per role
```

**`navConfig.js`:**

```js
export const navByRole = {
  admin: ["dashboard", "personnel"],
  oic: ["dashboard", "leave-management", "duty-roster", "complaints", "complaint-log", "reports", "settings"],
  duty_officer: ["dashboard", "duty-roster", "inventory", "leave", "complaints"],
  inventory_officer: ["dashboard", "inventory", "leave"],
  officer: ["dashboard", "leave", "complaints"],
};
```

---

## 6. Build Order

**Backend — done:**
1. Auth (login, JWT, role middleware)
2. Personnel & User Management (Admin) — server-side
3. Leave Requests + Balances + OIC approval
4. Complaints Registry + Complaint Log + Assign action + severity
5. Duty Roster — week-level model (`DutyRosterWeek`) with submit/approve/send-back, plus per-day shift cells
6. Inventory — ledger + issue/return/damaged transactions
7. Reports — summary stats, crime distribution, force strength (activity log is a stub)
8. Settings — RBAC matrix + notification toggles (stored, but not yet enforced — see open items)

**Frontend — in progress:**
9. Shared components — DONE (Button, InputField, Card, Table, Badge, Modal, Loader)
10. **Officer Dashboard + Leave Requests + Complaints Registry** — the 3 most-repeated screens, build once and reuse across Officer/Duty Officer/Inventory Officer views
11. **Inventory module** — dashboard + 4 tabs + 3 modals (Issue/Return/Add Item)
12. **Duty Roster** — generation tool + grid view + approve/send-back workflow (this is the most complex screen — the Mon-Sun x officer grid on page 14)
13. **OIC Command Dashboard** — stat cards + Leave Management inline-actions table + Incident Monitor table
14. **Reports & Analytics** — charts (use `recharts` per the artifact's available libraries)
15. **System Settings / RBAC** — toggle matrix + notification config

---

## 7. Open Items

- **Complaint severity/"Critical" flag** - page 5's Incident Monitor shows a red "Critical" status distinct from Unassigned/In-Progress/Resolved. Confirm: is severity set at registration time, or assigned later by OIC?
- **Roster week states** - page 14 shows "Draft" status with "Send Back to Revise" / "Approve" actions. Confirm the full state machine: draft -> submitted -> (approved | sent_back -> draft again)?
- **RBAC toggles are live config, not just role constants** - page 15's permission checkboxes (per rank: Chief Inspector/Inspector OIC/Sergeant/Constable) imply permissions are database-driven, not hardcoded like Section 1's matrix. **Status: built but not wired up** — `SystemSettings.rbac` exists and is editable via `/api/settings`, but `requireRole()` middleware still uses hardcoded role lists. Toggling a checkbox currently changes nothing about actual access. Decide: is this acceptable for the prototype (RBAC screen is UI-only/cosmetic for the demo), or does `requireRole()` need to read from this config at runtime?
- **Reports time range** - page 16 shows "Last 30 Days" / custom date controls. Confirm whether reports need arbitrary date-range filtering or just a few fixed presets.
