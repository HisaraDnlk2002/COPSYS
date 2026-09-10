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
| My Weapons (own firearm custody, read-only) | No | No | Yes | Yes | Yes |
| Create/edit weekly duty roster | No | Yes (generate, approve, send-back) | Yes (manual entry / primary author) | No | No |
| Reports & Analytics | All categories | All categories + station Overview | Duty reports only | Weapons + Ammunition reports only | No |
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
- **My Weapons** is a narrower, separate permission from the "Inventory
  module" row above it - not a loosening of it. It's a read-only view,
  scoped server-side to the logged-in user's own uid, of only their own
  currently-assigned firearm(s) and their own custody history (backed by
  `GET /api/inventory/my-weapons`, gated by nothing but a valid token -
  see inventoryRoutes.js). It does not grant any visibility into the
  station-wide ledger, other officers' custody, or any write access
  (issue/return/add still require the Inventory Officer role, unchanged).
  Admin and OIC are excluded since neither is an operational/patrol role
  that would carry a duty weapon.
- **Two-party weapon transaction confirmation (issue AND return).** Both
  `POST /inventory/:id/issue` and `POST /inventory/:id/return` create
  their transaction with `confirmationStatus: "pending"` - neither is
  "secured" until the officer *named on the transaction* confirms it
  themselves, via `PATCH /inventory/transactions/:id/confirm`
  (`confirmTransaction` in inventoryController.js, surfaced on the My
  Weapons page). That route enforces `req.user.uid === transaction
  .officerId` server-side - there is no Inventory Officer action,
  button, or endpoint anywhere that can set `confirmationStatus` to
  `"secured"` directly. This is deliberate: whoever processed a
  transaction can't also be the one who attests the officer's side of it
  happened. The Inventory Officer's own views (Issue/Return/Damaged
  tabs, Audit Ledger tab) only ever display this status (Pending /
  Secured), never control it.
  - **Issue:** the item's stock/status updates *immediately* at
    `issue()` time (it's physically out of the armory the moment it's
    handed over) - confirming only records the officer's acknowledgment
    of receipt. Deliberately NOT deferred to confirmation, unlike
    return below: deferring it would let two still-unconfirmed issues
    overcommit the same stock.
  - **Return / damaged:** the opposite. `returnItem()` does NOT touch
    the item at all - it only records what the Inventory Officer
    observed (condition, an optional ammo-issued/ammo-returned count
    reconciled into `ammoUsed`). The actual stock update (quantity
    restored, status -> available/damaged, `assignedTo` cleared) only
    happens inside `confirmTransaction` once the officer confirms they
    physically handed it back. This IS safe to defer (unlike issue)
    since nothing can be over-allocated by *not* freeing stock a moment
    sooner - the item just correctly stays "issued" to that officer
    until they confirm otherwise.
- **Maintenance module.** Own model/controller/routes
  (`/api/maintenance`), gated exactly like the rest of the Inventory
  module (view: duty_officer + inventory_officer; write: inventory_officer
  only) - not a separate permissions-matrix row, it's the Inventory
  module's Maintenance tab. Two rules enforced server-side, not just in
  the UI:
  - **A weapon under maintenance cannot be issued.** `issue()` rejects
    with 400 if `Inventory.status === "damaged"`.
  - **MAINTENANCE -> AVAILABLE only on a passed final inspection.**
    `Maintenance.update()`'s pending -> in_progress -> completed
    transitions are enforced in order (can't skip or go backwards); the
    completed transition requires `finalCondition` and
    `finalInspectionPassed` in the payload, and only sets
    `Inventory.status = "available"` when `finalInspectionPassed` is
    true. A completed record with a failed inspection leaves the item
    exactly as "damaged" as before - a fresh maintenance record is
    needed to try again.
  - **Auto-connected to Return.** `confirmTransaction` creates a
    Maintenance record automatically whenever a `type: "damaged"`
    return is confirmed (`reportedBy` = the Inventory Officer who
    processed the return, `sourceTransactionId` links back to it) -
    nothing manually opens a maintenance case from a damaged return.
- **Inspection module.** Own model/controller/routes
  (`/api/inspections`), gated identically to Maintenance - the
  Inventory module's Inspections tab, not a separate permissions row.
  The point: catch a weapon that's simply due a periodic check even
  though it's never been reported damaged by Issue/Return.
  - `Inventory.nextInspectionDate` (and `lastInspectionDate`) drive the
    Due/Overdue alerts - set on every new item at creation time
    (`INSPECTION_INTERVAL_DAYS`, currently 90, out from `create()`) so
    nothing added to the ledger sits outside the schedule from day one,
    and reset on every "passed" inspection.
  - **A failed inspection cannot leave the weapon available** - same
    rule and same mechanism as a damaged return: sets
    `Inventory.status = "damaged"` (blocked from `issue()`, same as
    above) and auto-creates a Maintenance record
    (`sourceInspectionId` links back), clearing
    `nextInspectionDate` until that maintenance record's own final
    inspection passes and reschedules it. **Inspection Failed ->
    Maintenance -> Final Inspection -> Available** is the same pipe as
    **Damaged Return -> Maintenance -> Final Inspection -> Available**;
    Inspection and Return are just the two different front doors into it.
  - Only items with `status` not `"issued"` or `"missing"` are
    inspectable (an item that's out with an officer, or unlocatable,
    can't be physically inspected at the armory) - enforced
    client-side (the Due list is filtered), not by the API, since
    there's nothing unsafe about the endpoint accepting an itemId for
    an issued item if someone did call it directly.
- **Alerts module.** Own model/controller/routes (`/api/alerts`),
  gated like Maintenance/Inspections for the station-wide feed
  (`GET /`), but `GET /mine` and `PATCH /:id` sit above that gate -
  reachable by every role, since the "relevant officer" an alert is
  about could be any of them (see My Weapons' alerts note below).
  Fully automatic - there is no create-alert endpoint or UI control
  anywhere; every alert is a side effect of something else happening.
  Dropped "Unauthorized weapon issue" from the reference spec's 13
  alert types - nothing in the system can actually trigger it (every
  issue already requires the Inventory Officer, and issuing a
  damaged/missing/under-maintenance item is already hard-blocked at
  the API, not something to alert on after the fact).
  - **Generation.** `generateAlert()` (server/src/utils/alerts.js) is
    called directly from the action that triggers each type - `issue()`
    -> weapon_issued, `returnItem()` -> return_awaiting_confirmation,
    `confirmTransaction()` -> weapon_returned / weapon_damage /
    ammo_discrepancy (when `ammoUsed > 0`) / maintenance_pending (on a
    damaged confirm), `reportMissing()` -> weapon_missing,
    `maintenanceController.update()` -> maintenance_completed,
    `inspectionsController.create()` -> inspection_completed always,
    plus inspection_failed + maintenance_pending on a failed result.
    Two types (`return_overdue`, `inspection_due`) aren't tied to a
    single action - they're conditions that become true purely with
    the passage of time - so `alertsController.list()` runs a scan for
    them on every fetch instead, gated by `overdueAlertGenerated` /
    `dueAlertGenerated` flags on the underlying documents so it never
    creates a duplicate for the same condition.
  - **Recipient.** `recipientId` is set to the specific officer an
    alert is personally about (issue/return/damage/ammo/overdue - all
    tied to a transaction with an officer on it) and left `null` for
    alerts that are purely armory-side bookkeeping (missing,
    inspection due/completed/failed, maintenance pending/completed) -
    those only ever show on the Inventory Officer's dashboard, never
    on any individual officer's own notifications.
  - **Lifecycle.** `NEW -> ACKNOWLEDGED -> ACTION_TAKEN -> RESOLVED`,
    one step at a time, enforced in `updateStatus()` - can't skip a
    step or go backwards, same pattern as Maintenance's status
    lifecycle. Callable by the Inventory Officer (any station alert)
    or the alert's own `recipientId` (their own only) - both
    surfaces (Inventory.jsx's Alerts tab, My Weapons' My Alerts
    section) call the same endpoint.
  - **In-app only.** No push/email/SMS delivery - Settings' Email
    Dispatch toggle remains exactly as decorative as it was before
    this module (stored, never enforced). An alert exists the moment
    it's generated; officers see it next time they load the relevant
    page.

**Left nav per role:**
- **Admin:** Dashboard, Personnel & User Management
- **OIC:** Dashboard, Leave Management, Duty Roster, Complaint Registry, Complaint Log, Reports, Settings
- **Duty Officer:** Dashboard, Duty Roster, Inventory, My Weapons, Leave Requests, Complaints & Logs (workflows 3 and 4 both say "Duty Officer" but show slightly different sidebars - treat as one role with the combined nav)
- **Inventory Officer:** Dashboard, Inventory, My Weapons, Leave Requests
- **Officer:** Dashboard, My Weapons, Leave Requests, Complaints Registry

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

**My Weapons** (Officer, Duty Officer, Inventory Officer - not a Figma workflow, added later):
- Stat cards: Weapons In My Custody (count), Awaiting Confirmation (count), Open Alerts (count), Last Activity (most recent transaction date)
- "Action Required: Confirm Transaction" panel - only rendered when the user has pending transactions; one row per issue OR return/damaged naming them with `confirmationStatus: "pending"`, each with a Confirm Receipt / Confirm Return button (copy varies by type) that opens a modal (item/quantity/condition/ammo-if-return details for review, optional remarks) calling `PATCH /inventory/transactions/:id/confirm`. See the confirmation-workflow note in Section 1 - this is the only place that endpoint is ever called from.
- "Weapons In My Custody" table: Item ID / Item Name / Quantity / Condition - only firearms currently assigned to the logged-in user (`Inventory.assignedTo === me && status === "issued"`) - a weapon with a pending (unconfirmed) return still shows here, since the officer remains formally accountable until they confirm it
- "My Custody History" table: Date & Time / Item ID / Type (Issued/Returned/Reported Damaged badge) / Quantity / Condition / Confirmation (Pending/Secured badge, all types) / Processed By / Remarks - the user's own last 20 firearm transactions, oldest ambiguity resolved by `dateTime` descending
- "My Alerts" table: Priority / Alert / Item ID / Generated / Status, with an Acknowledge/Mark Action Taken/Resolve button per row (copy depends on current status) - every alert with `recipientId === me`, from `GET /alerts/mine`. See the Alerts module note in Section 1.
- Read-only otherwise: no issue/return/add actions here, those stay on the Inventory module

**Inventory - Alerts tab** (Duty Officer view-only, Inventory Officer full - added later, not a Figma workflow):
- Filter bar: search, date range, Priority (All/Critical/Warning/Info), Status (All/New/Acknowledged/Action Taken/Resolved)
- Small counts: Critical (open only) / Open (any non-resolved)
- Table: Alert ID / Priority (badge) / Alert (title, full message on hover) / Item ID / Generated / Recipient / Status (badge) / an Acknowledge-or-next-step button, shown only to the Inventory Officer or the alert's own recipient
- Station-wide - every alert regardless of recipient, from `GET /alerts`, which also runs the return_overdue/inspection_due time-based scan (see Section 1) before returning

---

## 3. Data Model (MongoDB / Mongoose)

```
User
  fullName: string
  rankAndNumber: string         // also login username
  department: string
  role: "admin" | "oic" | "duty_officer" | "inventory_officer" | "officer"
  email: string                 // added for password-reset delivery; optional at the
                                 // schema level (accounts created before this field
                                 // existed have none), required on the "Register new
                                 // Personnel" form going forward
  status: "active" | "disabled" | "pending"
  passwordHash: string
  stationId: string

PasswordResetRequest             // one row per "Forgot password?" click on Login
  officerId: ref User
  officerName, rankAndNumber: string   // denormalized for the Admin queue
  status: "pending" | "fulfilled" | "rejected"
  resolvedBy: ref User | null
  resolvedByName: string
  resolvedAt: date | null
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

Inventory                           // NOTE: the model file/collection is actually named
                                     // "Inventory", not "InventoryItem" below - there's an
                                     // unused, near-identical InventoryItem model left over
                                     // in the codebase; don't add to it, it's dead.
  itemId: string                  // "WP-8821" style
  itemName: string
  category: "Firearms" | "Electronics" | etc
  quantity: number
  status: "available" | "issued" | "damaged" | "missing"   // "missing" only via
                                    // POST /inventory/:id/report-missing, blocked from
                                    // issue() same as "damaged" - no automatic path back,
                                    // has to be manually cleared once located
  assignedTo: ref User | null      // whoever the item was most recently issued to; cleared
                                    // only once a return is *confirmed* (see
                                    // confirmTransaction in Section 1) - check
                                    // status === "issued" alongside this too, since a
                                    // pending (unconfirmed) return leaves both as they were
  lastInspectionDate: date | null
  nextInspectionDate: date | null   // drives the Due/Overdue alerts - see Section 1
  dueAlertGenerated: boolean        // dedupes the inspection_due alert scan; reset to false
                                    // every time nextInspectionDate is (re)scheduled
  stationId: string
  lastUpdatedBy: ref User

InventoryTransaction                // covers Issue / Return / Damaged logs (workflow 3, page 8-9)
  itemId: ref Inventory            // was mistakenly "ref InventoryItem" - silently broke
                                    // every .populate("itemId"), fixed
  officerId: ref User              // who it was issued to / returned by
  processedBy: ref User | null     // which Inventory Officer carried out the transaction
  type: "issue" | "return" | "damaged"
  dutyType: string                  // "Patrol", "Traffic" - shown in the issue/return log tables
  quantity: number
  dateTime: date
  condition: string | null          // "Good" / "Faulty" - only on return
  remarks: string | null
  ammoIssued: number | null         // return/damaged only, entered by the Inventory Officer at return time
  ammoReturned: number | null       // return/damaged only, entered alongside ammoIssued
  ammoUsed: number | null           // derived: ammoIssued - ammoReturned, stored so it doesn't need recomputing
  confirmationStatus: "pending" | "secured" | null   // set for every type; see Section 1
  confirmedAt: date | null                            // set by confirmTransaction(), never by the Inventory Officer
  confirmationRemarks: string | null                  // optional, set by the confirming officer
  expectedReturnDate: date | null   // issue only, optional - Inventory Officer sets a deadline;
                                    // only issues with one set can ever go on to trigger a
                                    // return_overdue alert
  overdueAlertGenerated: boolean    // dedupes the return_overdue alert scan
  stationId: string

Maintenance                         // repair/inspection records, one per weapon sent out - see Section 1
  refId: string                    // "MR-0001" style, human-facing
  itemId: ref Inventory
  issueDescription: string
  reportedBy: ref User | null
  reportedDate: date
  maintenanceType: "Repair" | "Inspection" | "Cleaning" | "Part Replacement" | "Overhaul" | "Other"
  assignedTechnician: string        // free text, not a ref - often an external gunsmith, not a station account
  startDate: date | null            // set on pending -> in_progress
  completionDate: date | null       // set on in_progress -> completed
  partsCost: string                 // free text - no currency/accounting system elsewhere to key off
  remarks: string
  finalCondition: string | null     // only set on completion
  finalInspectionPassed: boolean | null   // only set on completion; gates Inventory.status -> "available"
  status: "pending" | "in_progress" | "completed"
  sourceTransactionId: ref InventoryTransaction | null   // set when auto-created from a damaged return
  sourceInspectionId: ref Inspection | null              // set when auto-created from a failed inspection
  stationId: string

Inspection                          // periodic physical checks, independent of Issue/Return/Maintenance - see Section 1
  refId: string                    // "INS-0001" style, human-facing
  itemId: ref Inventory
  inspectedBy: ref User
  inspectionDate: date
  inspectionType: "Scheduled" | "Random" | "Post-Maintenance" | "Other"
  condition: string                 // overall condition rating at time of inspection
  findings: string                  // physical/safety/cleanliness/function observations
  damageIssues: string               // specific damage or issues found, if any
  accessoriesChecked: string        // notes on parts/accessories inspected
  remarks: string
  result: "passed" | "failed"
  nextInspectionDate: date | null   // only set when result === "passed"; mirrors Inventory.nextInspectionDate
  resultingMaintenanceId: ref Maintenance | null   // set when a failed result auto-creates a Maintenance record
  stationId: string

Alert                                // every weapon-related notification - see Section 1
  refId: string                    // "ALT-0001" style, human-facing
  alertType: "weapon_missing" | "ammo_discrepancy" | "inspection_failed" | "weapon_damage"
           | "return_overdue" | "inspection_due" | "maintenance_pending" | "return_awaiting_confirmation"
           | "weapon_issued" | "weapon_returned" | "maintenance_completed" | "inspection_completed"
  priority: "critical" | "warning" | "info"        // derived 1:1 from alertType, see ALERT_PRIORITY in utils/alerts.js
  title: string
  message: string
  itemId: ref Inventory | null
  transactionId: ref InventoryTransaction | null
  maintenanceId: ref Maintenance | null
  inspectionId: ref Inspection | null              // at most one of these four is set, matching the alertType
  recipientId: ref User | null     // the officer this is personally about; null = armory-side only
  generatedAt: date
  status: "new" | "acknowledged" | "action_taken" | "resolved"
  acknowledgedBy: ref User | null
  acknowledgedAt: date | null
  actionTakenBy: ref User | null
  actionTakenAt: date | null
  resolvedBy: ref User | null
  resolvedAt: date | null
  remarks: string
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
POST   /api/users                                admin   (Register new Personnel — password is generated
                                                            server-side, returned once as `generatedPassword`;
                                                            never typed by Admin)
PATCH  /api/users/:id                            admin   (Edit User — name/department/role/phone/email/address)
PATCH  /api/users/:id/status                     admin
PATCH  /api/users/:id/password                   admin   (Reset Password button — generates + returns a new
                                                            password once, same as creation)

POST   /api/password-reset-requests             public  (Login page's "Forgot password?" — always responds
                                                            the same way whether or not the account exists)
GET    /api/password-reset-requests              admin   (queue on the Personnel page)
PATCH  /api/password-reset-requests/:id/approve  admin   (generates a new password and emails it to the
                                                            officer via Gmail SMTP — see server/src/utils/mailer.js;
                                                            Admin never sees the password itself)
PATCH  /api/password-reset-requests/:id/reject   admin

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

GET    /api/reports/summary                      admin, oic   (Duty Compliance %, Leave Statistics, Inventory Movements — station Overview only)
GET    /api/reports/crime-distribution            admin, oic   (bar chart data — station Overview only)
GET    /api/reports/force-strength                admin, oic   (line chart data, last 7 days — station Overview only)
GET    /api/reports/activity-log                  admin, oic, duty_officer, inventory_officer  (per-category report history; role scopes which `type` values are visible)
POST   /api/reports/preview                      admin, oic, duty_officer, inventory_officer  (runs the same query as generate, without logging it — powers the workbench's preview panel)
POST   /api/reports/generate                     admin, oic, duty_officer, inventory_officer  (logs a ReportExport row; role gates which `type` — see Section 1)
GET    /api/reports/:id/download                 admin, oic, duty_officer, inventory_officer  (regenerates the file from the stored date range + filters)
PATCH  /api/reports/:id/archive                  admin, oic, duty_officer, inventory_officer
DELETE /api/reports/:id                          admin, oic, duty_officer, inventory_officer

Report categories: **Duty** (duty_officer + admin/oic), **Officers**,
**Leave**, **Complaints**, **Station** (admin/oic only), **Weapons** +
**Ammunition** (inventory_officer + admin/oic). "Weapons"/"Ammunition"
replaced the original single "Inventory" report category — old
ReportExport rows logged before the split keep type `"inventory"` and
stay downloadable, but new reports are always generated as `"weapons"`.
Each category accepts its own whitelisted extra filters (e.g. Duty:
officer/shift/department; Complaints: category/status/priority/assigned
officer) on top of the date range — see `FILTER_KEYS_BY_TYPE` in
reportsController.js. The workbench flow is Period + Filters -> Preview
(no log entry yet) -> Download PDF/CSV (logs a ReportExport row and
streams the file); PDFs carry a station letterhead, the filters that were
applied, and a Prepared/Checked/Approved-By signature block.

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
    /Reports              - sidebar of report categories (role-scoped) + period/filter
                            workbench + preview panel + per-category report history;
                            admin/oic also get the station Overview (stat cards + 2 charts)
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
