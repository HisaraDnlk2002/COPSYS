# Edits of COPSYS

A log of every code change made to COPSYS, explained so you can learn
from it. Each entry covers:

- **What changed**: the result you see in the app.
- **How it was done**: the actual code, walked through.
- **Techniques used**: the general programming idea behind it, which you
  can reuse elsewhere.

The project is a **MERN-style app**:
- **M**ongoDB is the database.
- **E**xpress is the server framework (in `server/`).
- **R**eact is the screens (in `client/`).
- **N**ode.js runs the server.

The **client** (browser) sends HTTP requests to the **server** API
(`/api/...`). The server checks them, reads and writes MongoDB through
**Mongoose models**, and sends back JSON.

---

## 2026-09-23

### 1. Fixed a syntax error in the seed script

**File:** `server/src/seed.js`

**What changed:** `node src/seed.js` (which creates the starter
accounts) crashed with `SyntaxError: Unexpected token ':'`.

**How it was done:** line 16 contained a stray fragment of an object
that had been pasted in the wrong place:

```js
require("dns").setServers(["8.8.8.8", "8.8.4.4"]);

lName: "PC Nishadi", rankAndNumber: "65521", ...   // ← broken line, deleted
const bcrypt = require("bcryptjs");
```

The complete version of that entry already existed further down, inside
the `STARTER_USERS` array, so the broken line was simply removed.

**Techniques used**
- **Reading a stack trace.** Node printed the file, the line (`seed.js:16`)
  and a `^` pointing at the unexpected character. Always read the
  *first* error location; it tells you where to look.
- **Checking for duplicates before deleting.** Searching the file for
  `65521` showed the proper copy on line 37. That confirmed deleting
  line 16 loses no data.

---

### 2. Configuration files (`.env`)

**Files:** `server/.env` and `client/.env` (both new and git-ignored).

**What changed:** the server had no configuration, so it didn't know
which database to use or how to sign login tokens.

**How it was done:** the server reads settings with the `dotenv` package
(`require("dotenv").config()`), which loads `KEY=value` lines into
`process.env`:

```
MONGO_URI=mongodb://localhost:27017/police-station-mgmt
JWT_SECRET=<96 random hex characters>
JWT_EXPIRES_IN=8h
PORT=5000
CORS_ORIGIN=http://localhost:5173
GMAIL_USER=...   GMAIL_APP_PASSWORD=...   GMAIL_FROM_NAME=COPSYS
```

The secret was generated with Node's crypto module rather than typed by
hand:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Techniques used**
- **Environment variables for configuration.** Secrets and
  machine-specific values stay out of the code. Anything in `.env` is
  listed in `.gitignore`, so it's never committed.
- **Cryptographically random secrets.** `randomBytes` gives an
  unguessable JWT signing key. A human-typed "secret123" can be guessed.
- **Vite's `VITE_` prefix.** In `client/.env`, only variables starting
  with `VITE_` (e.g. `VITE_API_BASE_URL`) are exposed to browser code.
  This is a safety feature so server secrets can't leak into the
  frontend.

---

### 3. Weapon & ammunition catalog

**Files**
- New: `server/src/config/weaponCatalog.js`, `client/src/config/weaponCatalog.js`
- Changed: `server/src/controllers/inventoryController.js`,
  `client/src/pages/Inventory/Inventory.jsx`, `client/src/i18n/translations.js`

**What changed**
- The Add New Item form now uses **Category → Type dropdowns** instead
  of free text.
- There's a new **Ammunition** tab, separate from weapons.
- **My Weapons** now shows every weapon category, not only firearms.

**How it was done**

*Step 1: one list, defined once.* The categories and their types live in
a single data structure:

```js
const WEAPON_CATALOG = [
  { category: "Firearms", types: ["Pistol", "Revolver", "Shotgun", "Assault Rifle", ...] },
  { category: "Less-Lethal / Control Equipment", types: ["Baton", "Pepper Spray", ...] },
  { category: "Other Weapons", types: ["Police Knife", "Riot-Control Shield", ...] },
  { category: "Ammunition", types: ["9mm Ammunition", ".38 Ammunition", ...] },
];

// Derived from the list above, not typed out separately:
const WEAPON_CATEGORIES = WEAPON_CATALOG.map((c) => c.category).filter((c) => c !== "Ammunition");
```

*Step 2: dependent dropdowns (React).* The Type dropdown's options are
computed from whatever Category is selected, and changing the category
clears the old type:

```jsx
onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value, weaponType: "" }))}
...
options={typesForCategory(addForm.category).map((type) => ({ value: type, label: type }))}
```

*Step 3: the server double-checks.*

```js
if (!isValidCatalogEntry(category, itemName)) {
  return res.status(400).json({ error: "Unknown weapon category or type" });
}
```

*Step 4: splitting the list for the two tabs.* The inventory list is
split in the browser with `.filter()`:

```js
const weaponItems = items.filter((i) => i.category !== AMMUNITION_CATEGORY);
const ammunitionItems = items.filter((i) => i.category === AMMUNITION_CATEGORY);
```

*Step 5: My Weapons.* The server's firearm-only check
`tx.itemId?.category === "Firearms"` became
`WEAPON_CATEGORIES.includes(tx.itemId?.category)`.

**Techniques used**
- **Single source of truth.** The list is written once and everything
  else (dropdowns, validation, filters) is *derived* from it. Adding a
  new weapon type means editing one array.
- **Mirrored config across client and server.** The browser needs the
  list to draw dropdowns, and the server needs it to validate. They are
  separate programs, so each has a copy that must be kept identical.
- **Never trust the client.** The dropdown stops honest mistakes. The
  **server-side validation** stops anyone who sends a request directly
  (e.g. with `curl`). Always validate on the server.
- **HTTP status codes.** `400 Bad Request` means invalid input and
  `409 Conflict` means a duplicate. The frontend shows the `error`
  message from the JSON body.
- **Immutable state updates in React.** `setAddForm((f) => ({ ...f, category }))`
  copies the old object with the spread operator `...` and overrides
  one field. React only re-renders when it gets a *new* object.
- **Derived data instead of stored data.** The weapon and ammunition
  lists are computed from `items` on every render, so they can never go
  out of sync.

---

### 4. Full Weapon Management workflow

The module was compared against the COPSYS workflow spec (Register →
Issue → Officer confirms → Return → Officer confirms → Inspection →
Maintenance → Ammunition → Alerts → Reports). The missing pieces were
added.

#### 4.1 New database fields (Mongoose schemas)

**Files:** `server/src/models/Inventory.js`,
`server/src/models/InventoryTransaction.js`, `server/src/models/Alert.js`

**How it was done:** fields were added to the schemas. For example:

```js
// Inventory.js
serialNumber: { type: String, default: "", trim: true },
caliber: { type: String, default: "", trim: true },
storageLocation: { type: String, default: "", trim: true },
lowStockThreshold: { type: Number, default: null, min: 0 },
lowStockAlertGenerated: { type: Boolean, default: false },

// InventoryTransaction.js
ammoItemId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", default: null },
ammoDeclaredUsed: { type: Number, default: null },
ammoDiscrepancy: { type: Number, default: null },
accessories: { type: String, default: "" },
accessoriesComplete: { type: Boolean, default: null },
confirmationReminderGenerated: { type: Boolean, default: false },
```

**Techniques used**
- **Schema defaults for backward compatibility.** Every new field has a
  `default`, so documents saved *before* the change still load fine.
  MongoDB doesn't need a migration for that.
- **`null` vs `0`.** `ammoDeclaredUsed: null` means "not recorded",
  while `0` means "recorded as zero rounds". The code relies on that
  difference.
- **References (`ref`).** `ammoItemId` stores the `_id` of another
  document. `.populate("ammoItemId", "itemId itemName")` then swaps the
  id for the real document when reading, like a JOIN in SQL.
- **Enums.** `Alert.js` lists the allowed `alertType` values, so
  Mongoose rejects typos. The new types were added there:
  `low_ammo_stock`, `confirmation_overdue` and `accessories_missing`.

#### 4.2 Registration: required serial number, schedule from last inspection

**File:** `inventoryController.js` → `create()`

**How it was done**

```js
if (!isAmmunition && !serialNumber?.trim()) {
  return res.status(400).json({ error: "Serial number is required for a weapon" });
}
const serialTaken = await Inventory.exists({ serialNumber: serialNumber.trim() });
if (serialTaken) return res.status(409).json({ error: "A weapon with that serial number is already registered" });

const scheduleFrom = lastInspected || new Date();
nextInspectionDate: isAmmunition ? null
  : new Date(scheduleFrom.getTime() + INSPECTION_INTERVAL_DAYS * 24 * 60 * 60 * 1000),
```

**Techniques used**
- **Guard clauses / early return.** Each invalid case `return`s
  straight away with an error. The "happy path" stays un-nested and
  easy to read.
- **Optional chaining `?.`.** `serialNumber?.trim()` doesn't crash if
  `serialNumber` is `undefined`.
- **Date arithmetic in milliseconds.** `getTime()` gives milliseconds,
  and 90 days = `90 × 24 × 60 × 60 × 1000`.

#### 4.3 Issue eligibility checks

**File:** `inventoryController.js` → `getOutstandingIssues()` and
`checkIssueEligibility()`

**What changed:** an issue is refused in any of these cases:
- the officer's account isn't active;
- the officer is an Admin or OIC;
- the officer is on approved leave;
- the officer has an overdue weapon;
- the officer already holds that item;
- the officer already holds a firearm and is being issued another one.

**How it was done:** the key function works out what an officer
*currently holds* from their transaction history:

```js
async function getOutstandingIssues(officerId) {
  const txs = await InventoryTransaction.find({ officerId }).sort({ dateTime: 1 })
    .populate("itemId", "itemId itemName category");
  const byItem = new Map();
  for (const tx of txs) {
    const key = tx.itemId._id.toString();
    const entry = byItem.get(key) || { item: tx.itemId, net: 0, lastIssue: null };
    if (tx.type === "issue") { entry.net += tx.quantity || 1; entry.lastIssue = tx; }
    else { entry.net -= tx.quantity || 1; }
    byItem.set(key, entry);
  }
  return [...byItem.values()].filter((e) => e.net > 0);
}
```

The leave check is a date-range overlap query:

```js
const onLeave = await LeaveRequest.exists({
  officerId, status: "approved",
  startDate: { $lte: now }, endDate: { $gte: startOfToday },
});
```

`checkIssueEligibility()` returns an **error message string, or `null`**
if everything is fine, and `issue()` sends that message back to the
screen.

**Techniques used**
- **Event sourcing / ledger netting.** Instead of trusting a single
  "status" field, the current state is *computed* by replaying the
  history: +1 per issue, −1 per return. That's how banks compute a
  balance from transactions, and it can't drift out of sync.
- **`Map` for grouping.** `Map` keyed by item id is a fast way to group
  and sum records.
- **MongoDB query operators.** `$lte` means "less than or equal" and
  `$gte` means "greater than or equal". Together they test whether
  *today* falls inside the leave period.
- **Helper functions with a single responsibility.**
  `getOutstandingIssues` is reused by the issue *and* return code
  (don't repeat yourself).

#### 4.4 Ammunition management and reconciliation

**File:** `inventoryController.js` → `issue()`, `returnItem()`,
`confirmTransaction()`, `restock()`

**What changed**
- Rounds are drawn from a real ammunition batch at issue time.
- At return, the officer's declared rounds fired are compared with the
  physical count.
- Only a mismatch raises an alert.

**How it was done**

*At issue:* the ammunition stock is decreased immediately, and the
batch id is saved on the transaction:

```js
ammoItem.quantity -= rounds;
await ammoItem.save();
...
ammoIssued: rounds, ammoItemId: ammoItem._id,
```

*At return:* the math is done on the server, using the issued count
from the *original issue record* (not whatever the form sends):

```js
const issuedRounds = hasValue(sourceIssue?.ammoIssued) ? sourceIssue.ammoIssued : ...;
const ammoUsed = issuedRounds - returnedRounds;           // Used = Issued − Returned
const ammoDiscrepancy = ammoUsed - declaredUsed;          // what doesn't add up
```

*At the officer's confirmation:* only now do unused rounds go back into
stock, and an alert is raised only if `ammoDiscrepancy !== 0`:

```js
if (tx.ammoItemId && tx.ammoReturned > 0) {
  ammoItem.quantity += tx.ammoReturned;
  await ammoItem.save();
}
const unreconciled = tx.ammoDiscrepancy !== null ? tx.ammoDiscrepancy : tx.ammoUsed;
if (unreconciled !== null && unreconciled !== 0) { await generateAlert({ alertType: "ammo_discrepancy", ... }); }
```

**Techniques used**
- **Server-computed values.** Totals are calculated on the server from
  trusted data. The client can't tamper with "rounds issued".
- **Two-phase commit (a simple form of it).**
  1. The Inventory Officer *records* the return (phase 1).
  2. The stock only changes when the officer *confirms* it (phase 2).

  Nobody can change stock on their own say-so, which is the
  accountability rule in the spec.
- **Fallback for old data.** Older records have no `ammoDeclaredUsed`,
  so `unreconciled` falls back to `ammoUsed`. New logic doesn't break
  old records.

#### 4.5 Low-stock alerts without duplicates

**File:** new `server/src/utils/ammoStock.js`

**How it was done**

```js
async function syncLowStockAlert(item) {
  if (item.lowStockThreshold === null || item.lowStockThreshold === undefined) return;
  const isLow = item.quantity <= item.lowStockThreshold;
  if (isLow && !item.lowStockAlertGenerated) {
    await generateAlert({ alertType: "low_ammo_stock", ... });
    item.lowStockAlertGenerated = true;   // don't alert again for this dip
    await item.save();
  } else if (!isLow && item.lowStockAlertGenerated) {
    item.lowStockAlertGenerated = false;  // re-arm once stock recovers
    await item.save();
  }
}
```

It's called after *every* stock change: issue, confirmed return, restock
and edit.

**Techniques used**
- **Idempotency with a flag.** Calling the function 100 times gives
  the same result as calling it once: one alert per "dip". This is
  sometimes called a *latch* or *edge-triggered* alert (it fires on the
  change, not on every check).
- **Extracting shared logic into a utility module.** Several places
  need it, so it lives in `utils/` and is imported where needed.

#### 4.6 Accessories and confirmation reminders

**Files:** `inventoryController.js`, `server/src/controllers/alertsController.js`

**How it was done**
- *Accessories:* the issue stores what went out, and the return stores
  `accessoriesComplete` plus notes. On confirmation, `false` raises an
  `accessories_missing` alert.
- *Reminders:* the existing alert scan (it runs each time alerts are
  loaded) got a new step:

```js
const reminderCutoff = new Date(now.getTime() - CONFIRMATION_REMINDER_HOURS * 60 * 60 * 1000);
const unconfirmed = await InventoryTransaction.find({
  confirmationStatus: "pending",
  createdAt: { $lt: reminderCutoff },
  confirmationReminderGenerated: false,
});
for (const tx of unconfirmed) { await generateAlert(...); tx.confirmationReminderGenerated = true; await tx.save(); }
```

**Techniques used**
- **Lazy / on-demand scanning.** Instead of a background timer (cron),
  time-based alerts are generated when someone opens the alerts list.
  It's simpler, with no extra process to run.
- **Named constants.** `CONFIRMATION_REMINDER_HOURS = 2` sits at the
  top of the file, so the rule is easy to find and change.
- **The same "generated" flag pattern as 4.5** prevents repeat alerts.

#### 4.7 Maintenance: failed final inspection stays in maintenance

**File:** `server/src/controllers/maintenanceController.js`

**How it was done:** when a maintenance record is completed with
`finalInspectionPassed: false`, a **follow-up** record is created
automatically (copying the type and technician), and an alert is sent:

```js
if (!record.finalInspectionPassed) {
  const followUp = await Maintenance.create({
    refId: await generateRefId(),
    itemId: item._id,
    issueDescription: `Failed final inspection after ${record.refId}`,
    ...
  });
}
```

**Technique used:** **state machine thinking.** A weapon's life is a set
of states (Available → Issued → Returned → Maintenance → Available).
Every transition needs a defined next state. Before this change, "failed
final inspection" led nowhere.

#### 4.8 OIC access (role-based access control)

**Files**
- Server: `inventoryRoutes.js`, `alertRoutes.js`, `maintenanceRoutes.js`,
  `inspectionRoutes.js`, `alertsController.js`
- Client: `config/navConfig.js`, `App.jsx`, `Inventory.jsx`

**How it was done:** routes are protected by a middleware that checks the
logged-in user's role. `"oic"` was added to the *read* routes only:

```js
router.use(requireRole("duty_officer", "inventory_officer", "oic"));  // can view
router.get("/", list);
router.post("/", requireRole("inventory_officer"), create);            // writes stay restricted
```

On the client, the OIC got a sidebar link and route permission. The page
uses a flag to show action buttons only to the right roles:

```js
const canManage = user?.role === "inventory_officer";
const canActOnAllAlerts = canManage || user?.role === "oic";
```

**Techniques used**
- **Express middleware chain.** `router.use(...)` runs for every route
  below it. A route can add a stricter check of its own.
- **Principle of least privilege.** The OIC gets exactly what the spec
  needs (view, and handle alerts) and nothing more.
- **Defence in depth.** Hiding buttons on the client is for
  convenience. The *server* check is what actually enforces access.

#### 4.9 New reports and audit logging

**Files:** `server/src/controllers/reportsController.js`,
`server/src/models/ReportExport.js`, `client/src/pages/Reports/Reports.jsx`,
plus the inspection and maintenance controllers.

**How it was done:** the report system is **table-driven**. Each report
type is registered in a few lookup objects (allowed roles, label,
allowed filters) and has one `if (type === "...")` block that returns
`{ columns, rows }`:

```js
const CATEGORY_ROLES = { ..., maintenance: ["admin", "oic", "inventory_officer"], ... };
const REPORT_TYPE_LABELS = { ..., maintenance: "Weapon Maintenance", ... };

if (type === "maintenance") {
  const rows = await Maintenance.find(filter).populate("itemId", "itemId itemName").lean();
  return { columns: [{ key: "refId", label: "Ref ID" }, ...], rows: rows.map((r) => ({ refId: r.refId, ... })) };
}
```

The "Overdue & Discrepancies" report reads from the **alerts
collection**, since every exception is already an alert.

Audit logging adds one call after each important action:

```js
logAuditForActor(req, { action: `Inspected ${item.itemId} (${record.refId}) — ${result}`, module: "Inventory" });
```

**Techniques used**
- **Table-driven / data-driven design.** Adding a report means adding
  entries to lookup tables plus one data block. The PDF, CSV and
  preview code is shared and didn't need touching.
- **`.lean()`.** Returns plain JS objects instead of full Mongoose
  documents. It's faster for read-only work like reports.
- **Reusing existing data.** No new "exceptions" table was needed,
  because the alert trail already had it.
- **Fire-and-forget logging.** `logAuditForActor` doesn't `await`, so
  a slow log write never delays the user's request.

#### 4.10 Testing the workflow

**How it was done**
1. A second copy of the server was started on port **5055**, pointed at
   a **throwaway database** (`copsys-workflow-test`).
2. A Node script (`fetch` calls) logged in as each role and walked
   through the whole workflow, checking about 60 expected outcomes
   (e.g. "second firearm blocked", "25 rounds back in stock").
3. Afterwards the test server was stopped and the test database was
   dropped.

**Techniques used**
- **End-to-end (E2E) API testing.** This tests the real server and
  database together, the way the app uses them.
- **Test isolation.** A separate database means tests can't damage
  real data, and each run can start clean.
- **Testing the "unhappy paths".** Most checks confirm that bad
  actions are *rejected*, not just that good ones work.

---

### 5. Login "Load failed": CORS fix

**File:** `server/src/index.js`

**What changed:** logging in from a frontend running on port 5174
failed.

**How it was done**
- Browsers enforce **CORS** (Cross-Origin Resource Sharing): a page on
  `localhost:5174` may only call an API on `localhost:5000` if the API
  says that origin is allowed.
- The server allowed only `localhost:5173`. Vite had moved to 5174
  because 5173 was taken.
- The fix swaps the fixed list for a function that also accepts any
  local port:

```js
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",");
const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

app.use(cors({
  origin: (origin, callback) => {
    callback(null, !origin || allowedOrigins.includes(origin) || LOCAL_DEV_ORIGIN.test(origin));
  },
}));
```

**Techniques used**
- **Diagnosing by elimination.**
  1. `curl` to the login API worked, so the server was fine.
  2. `lsof` showed two frontends, on 5173 and 5174.
  3. A CORS "preflight" test (`curl -X OPTIONS -H "Origin: ..."`) showed
     5174 was blocked.
- **Regular expressions.** `^http:\/\/(localhost|127\.0\.0\.1):\d+$`
  means "starts with http://, then localhost or 127.0.0.1, a colon, one
  or more digits (`\d+`), and nothing else". The `^` and `$` anchors
  stop tricks like `localhost:5000.evil.com`.
- **The `cors` package's callback form.** `origin` can be a function
  that decides per request, which is more flexible than a fixed list.

---

### 6. Caliber and Storage Location dropdowns

**Files:** both `weaponCatalog.js` files, `inventoryController.js`,
`Inventory.jsx`, `translations.js`

**What changed**
- Storage Location is a dropdown.
- Caliber is **filled in automatically** when the weapon type has only
  one (Pistol → 9mm). A dropdown appears only for Assault Rifle and
  Rifle (5.56mm or 7.62mm).

**How it was done**

```js
const CALIBERS_BY_TYPE = {
  Pistol: ["9mm"], Revolver: [".38"], Shotgun: ["12 Gauge"],
  "Assault Rifle": ["5.56mm", "7.62mm"], "Submachine Gun": ["9mm"],
  Rifle: ["7.62mm", "5.56mm"], "Sniper Rifle": ["7.62mm"],
};
```

When the type changes, the form auto-fills a single caliber:

```jsx
const calibers = calibersForType(e.target.value);
setAddForm((f) => ({ ...f, weaponType: e.target.value, caliber: calibers.length === 1 ? calibers[0] : "" }));
```

The form then shows either a read-only field or a dropdown, using a
**ternary** in JSX:

```jsx
{calibersForType(addForm.weaponType).length > 1 ? (
  <InputField type="select" ... />
) : (
  <InputField readOnly value={addForm.caliber} />
)}
```

The server repeats the logic, so the value can't be faked: it sets the
caliber itself for single-caliber types and requires a valid choice for
the others.

**Techniques used**
- **Lookup tables (dictionaries).** An object maps type → calibers.
  It's easier to read and change than a long `if/else` chain.
- **Conditional rendering.** React shows different elements depending
  on state, with `condition ? A : B` and `condition && A`.
- **Good UX: don't ask what you already know.** If the answer is
  certain, fill it in. Only ask when there's a real choice.

---

### 7. Accessories as tick-boxes

**Files:** both `weaponCatalog.js` files, `inventoryController.js`,
`Inventory.jsx`, `Inventory.css`, `translations.js`

**What changed**
- The Issue form shows tick-boxes for the accessories that belong with
  the selected weapon.
- The Return form lets you tick which issued accessories are missing.

**How it was done**

*A reusable component* was written inside `Inventory.jsx`:

```jsx
function CheckboxGroup({ label, options, selected, onChange, emptyText }) {
  function toggle(option) {
    onChange(selected.includes(option)
      ? selected.filter((o) => o !== option)   // untick: remove it
      : [...selected, option]);                // tick: add it
  }
  return (
    <div className="inventory-checkbox-group">
      {options.map((option) => (
        <label key={option} className={`inventory-checkbox${selected.includes(option) ? " checked" : ""}`}>
          <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
          {option}
        </label>
      ))}
    </div>
  );
}
```

It's used twice: on the Issue form, with options from
`accessoriesForType(item.itemName)`, and on the Return form, with the
accessories recorded on the original issue.

*The server* accepts the list, checks each item belongs to the weapon
type, and stores it as readable text:

```js
const accessoryList = Array.isArray(accessories) ? accessories : (accessories || "").split(",").map((a) => a.trim()).filter(Boolean);
const unknownAccessory = accessoryList.find((a) => !accessoriesForType(item.itemName).includes(a));
if (unknownAccessory) return res.status(400).json({ error: `"${unknownAccessory}" isn't an accessory for a ${item.itemName}` });
...
accessories: accessoryList.join(", "),
```

*Styling* uses the app's existing design tokens (`var(--color-primary)`,
`var(--radius-md)`, `var(--space-sm)`), so the tick-boxes match the rest
of the app. It includes a highlighted style when checked.

**Techniques used**
- **Reusable components.** One `CheckboxGroup` serves two forms. Props
  (`options`, `selected`, `onChange`) make it generic.
- **Controlled components.** The checkbox's `checked` comes from React
  state, and clicking calls `onChange`. React state is the single source
  of truth, not the DOM.
- **Toggling an item in an array immutably.** Use `filter` to remove
  and spread `[...arr, x]` to add. Never `push` into state.
- **`key` prop in lists.** React needs a unique `key` for each item in
  `.map()` to track them between renders.
- **Accepting flexible input.** The server handles both an array and an
  older comma-separated string. This is *being liberal in what you
  accept*, while still validating every value.
- **CSS design tokens (custom properties).** Colours and spacing come
  from shared variables, so the whole app stays consistent and theme
  changes happen in one place.

---

### 8. Translations for every new label (English + Sinhala)

**File:** `client/src/i18n/translations.js` (used by every change above)

**How it was done:** screen text is never hard-coded in components. A
component asks for a key, and the file holds the text for each language:

```jsx
<InputField label={t("inventory.colSerialNumber")} ... />
```

```js
// English section
colSerialNumber: "Serial Number",
// Sinhala section
colSerialNumber: "අනුක්‍රමික අංකය",
```

The existing Sinhala term for ammunition (පතොරම්) was reused so the
wording stays consistent.

**Techniques used**
- **Internationalisation (i18n).** Separating text from code lets the
  app switch languages, and lets you change wording without touching
  logic. To rename a label, edit the text in quotes, never the key.
- **Consistency with existing terminology.** Search for how a word is
  already translated before adding a new one.

---

### 9. "Reason" field when a returned weapon is Faulty

**Files:** `client/src/pages/Inventory/Inventory.jsx`,
`server/src/controllers/inventoryController.js`, `client/src/i18n/translations.js`

**What changed**
- On the Return Item form, choosing **Weapon Condition → Faulty** shows
  a required **Reason** box (e.g. "Slide jams after firing").
- Choosing **Good** hides it again.
- The reason becomes the **issue description on the maintenance
  record** that opens automatically once the officer confirms the
  return. Before, that record just said "Reported damaged on return".

**How it was done**

*1. A new field in the form's starting state:*

```js
const EMPTY_RETURN_FORM = { ..., condition: "", faultReason: "", ... };
```

*2. Show the box only for Faulty (conditional rendering):*

```jsx
{returnForm.condition === "Faulty" && (
  <InputField
    label={t("inventory.faultReason")}
    type="textarea"
    required
    value={returnForm.faultReason}
    onChange={(e) => setReturnForm((f) => ({ ...f, faultReason: e.target.value }))}
    voiceInput
    sinhalaTyping
  />
)}
```

*3. Clear the reason if the condition goes back to Good.* This stops a
stale reason being sent by accident:

```jsx
onChange={(e) =>
  setReturnForm((f) => ({ ...f, condition: e.target.value, faultReason: e.target.value === "Faulty" ? f.faultReason : "" }))
}
```

*4. Check it before sending (client), and send it as `remarks`:*

```js
if (returnForm.condition === "Faulty" && !returnForm.faultReason.trim()) {
  setModalError(t("inventory.errFaultReason"));
  return;
}
...
remarks: returnForm.condition === "Faulty" ? returnForm.faultReason.trim() : undefined,
```

*5. Enforce it on the server too:*

```js
if (condition.toLowerCase() === "faulty" && !remarks?.trim()) {
  return res.status(400).json({ error: "Give the reason the weapon is faulty" });
}
```

No other server change was needed. `returnItem()` already saved
`remarks` on the transaction, and `confirmTransaction()` already copies
it into the maintenance record:

```js
issueDescription: tx.remarks || "Reported damaged on return",
```

The form simply never sent it until now.

**Techniques used**
- **Conditional rendering with `&&`.** `condition && <Element />`
  renders the element only when the condition is true. It's the usual
  React way to show or hide a field.
- **Resetting dependent state.** When one field controls another, clear
  the dependent value when the controller changes (the same idea as
  Category → Type in section 3).
- **Validation on both sides.** The client check gives instant
  feedback. The server check is the real guarantee.
- **Reuse existing plumbing.** Before adding anything new, trace where
  the data already flows (`remarks` → transaction → maintenance). Here
  the backend was already built. Only the form was missing a field.
- **Reusing component features.** `voiceInput` and `sinhalaTyping` are
  existing `InputField` options, so the reason can be dictated or typed
  in Sinhala for free.

---

### 10. Department column on the Issuing and Returned logs

**Files:** `server/src/controllers/inventoryController.js`,
`client/src/pages/Inventory/Inventory.jsx`

**What changed**
- The **Equipment Issuing Log** and **Equipment Returned Log** tables
  have a **Department** column next to Officer Name (e.g. "Traffic
  Branch (ගමනාගමන අංශය)").
- Small display fix: older issue records showed "6 × —" in Ammunition
  Issued, because they were created before rounds were linked to an
  ammunition batch. They now show just "6".

**How it was done**

*1. Server: include the field in the populate.* A transaction only
stores the officer's `_id`. `populate()` fetches the officer document
and the second argument lists which fields to bring back. `department`
was added:

```js
const transactions = await InventoryTransaction.find(filter)
  .populate("officerId", "fullName rankAndNumber department")   // ← added "department"
```

*2. Client: one new column definition in each table.* The `Table`
component draws whatever is in its `columns` array. Each column has a
`key`, a `label` (heading) and an optional `render` function that picks
the value out of the row:

```js
{ key: "department", label: t("personnel.colDepartment"), render: (row) => row.officerId?.department || "—" },
```

The same line was inserted after "Officer Name" in both `issueColumns`
and `returnColumns`.

*3. Ammunition display fix:* a `render` function with an early return
and a fallback:

```js
render: (row) => {
  if (!row.ammoIssued) return "—";
  return row.ammoItemId?.itemName ? `${row.ammoIssued} × ${row.ammoItemId.itemName}` : row.ammoIssued;
},
```

**Techniques used**
- **Mongoose `populate` with field selection.** Only the fields you ask
  for are sent (`"fullName rankAndNumber department"`). This keeps
  responses small and avoids leaking fields the screen doesn't need,
  such as the password hash.
- **Declarative table columns.** The table is described as *data* (an
  array of column objects), not hand-written HTML. Adding a column is
  one line, and the same pattern works for every table in the app.
- **Reusing an existing translation key.** A "Department" label already
  existed under `personnel` (English "Department", Sinhala "අංශය"), so
  `t("personnel.colDepartment")` was used instead of duplicating it.
- **Optional chaining + fallback.** `row.officerId?.department || "—"`
  shows a dash instead of crashing or showing blank if the officer has
  no department or was deleted.
- **Verifying against the live API.** A read-only `curl` call confirmed
  the server now sends `department` before the change was called done.

---

### 11. Officer's department filled in automatically on Issue & Return forms

**Files:** `client/src/services/officers.js`,
`client/src/pages/Inventory/Inventory.jsx`, `client/src/i18n/translations.js`

**What changed**
- On the **Issue Item** and **Return Item** forms, choosing an officer
  now shows their **Department** in a read-only field next to them.
- The value comes from the department saved on the officer's profile
  (Personnel), so nobody types it.

**How it was done**

*1. Found where the data was being lost.* The server's officer search
(`officersController.js`) already selected `department`:

```js
.select("fullName rankAndNumber phoneNumber role department")
```

But the client helper that converts the results into dropdown options
built a new object and left `department` out. It was added:

```js
return officers.map((officer) => ({
  value: officer.id,
  label: `${officer.fullName} — ${officer.phoneNumber}`,
  ...
  rankAndNumber: officer.rankAndNumber,
  department: officer.department,   // ← added
}));
```

*2. It flows through automatically.* The Inventory page's own search
helper copies every field with the spread operator, so `department` is
now on the selected officer option (`issueForm.officer`):

```js
officers.map((o) => ({ ...o, label: `${o.fullName} — ${o.rankAndNumber}` }))
```

*3. A read-only field displays it (the same in both forms):*

```jsx
<InputField
  label={t("personnel.colDepartment")}
  readOnly
  value={issueForm.officer ? issueForm.officer.department || "—" : ""}
  placeholder={t("inventory.departmentAuto")}   // "Filled in from the officer's profile"
/>
```

Before an officer is picked, the field shows the placeholder hint.
After, it shows the department, or "—" if the profile has none.

**Techniques used**
- **Tracing data through the layers.** Database → server `select` →
  API JSON → client service `map` → component state. The field existed
  in the first three layers and was dropped in the fourth. Follow the
  data step by step to find the exact gap instead of guessing.
- **Derived (computed) values instead of stored input.** The
  department isn't a new piece of form state. It's read from the
  already-selected officer, so it can't disagree with the officer's
  real profile.
- **Read-only fields for information.** `readOnly` shows the value in
  the same style as the other fields but stops editing, which makes it
  clear this is looked up, not entered.
- **Additive, backward-compatible changes.** Adding a property to the
  objects `searchOfficers` returns doesn't break other pages that use
  it (such as Leave Requests). They simply ignore the extra field.

---

### 12. One weapon per officer (ammunition can be many)

**Files:** `server/src/controllers/inventoryController.js`,
`client/src/pages/Inventory/Inventory.jsx`

**What changed**
- An officer can hold **only one weapon at a time, of any kind**
  (firearm, baton, taser, shield...). Before, the rule was one
  *firearm*, so a pistol plus a baton was allowed.
- Issuing a second weapon is refused with a message such as "PC Nishadi
  already holds a weapon (P1 — Pistol). It must be returned before
  another is issued".
- Each issue is **exactly 1 weapon**, so the "Quantity to Issue" and
  "Quantity to Return" boxes were removed from the forms.
- **Ammunition is unchanged**: any number of rounds can go out with the
  one weapon.

**How it was done**

*1. The eligibility rule got simpler.* `getOutstandingIssues()` (see
4.3) already lists everything an officer still holds. Since ammunition
can never be issued on its own (it rides on the weapon's record),
anything in that list is a weapon. So the rule became "the list must be
empty":

```js
// before: two checks (same item / second firearm)
// after:
if (outstanding.length > 0) {
  const held = outstanding[0].item;
  return `${officer.fullName} already holds a weapon (${held.itemId} — ${held.itemName}). It must be returned before another is issued`;
}
```

*2. Quantity is fixed on the server, not taken from the form:*

```js
if (req.body.quantity !== undefined && Number(req.body.quantity) !== 1) {
  return res.status(400).json({ error: "Only one weapon can be issued to an officer at a time" });
}
const quantity = 1;
```

*3. On return, the quantity is worked out, not typed.* It's whatever
the officer actually holds of that item. That's normally 1, but it
still covers any older record issued with more than one:

```js
const quantity = open.net;   // from getOutstandingIssues()
```

*4. Client:* the two quantity inputs, their state (`quantity: ""` in
`EMPTY_ISSUE_FORM` / `EMPTY_RETURN_FORM`) and their validation were
removed. The issue request now always sends `quantity: 1`.

*5. Tested* on a separate throwaway server and database:
- quantity 3 rejected;
- pistol + 120 rounds issued;
- a baton for the same officer blocked;
- return without a quantity accepted;
- after the return, a new weapon allowed.

The test database was deleted afterwards.

**Techniques used**
- **Simplifying a rule by using what you already know.** Because
  "outstanding items" can only ever be weapons, the business rule
  "one weapon" becomes one line (`outstanding.length > 0`). Look for
  facts the system already guarantees before writing extra checks.
- **Server-owned values.** The server sets `quantity = 1` itself (issue)
  or computes it (return), rather than trusting a number from the form.
  If the value can only be one thing, don't let the user enter it.
- **Remove dead code completely.** When a field disappears, delete its
  input, its state, its reset logic and its validation. Leftover code
  confuses the next person who reads it.
- **Backward compatibility with old records.** Using `open.net` for
  returns means any weapon issued in a quantity above 1 before this
  change can still be returned in full.

---

### 13. "Return to Stock" step after maintenance

**Files**
- Server:
  - `server/src/models/Inventory.js`, `server/src/models/Maintenance.js`
  - `server/src/controllers/maintenanceController.js`,
    `server/src/controllers/inventoryController.js`,
    `server/src/controllers/reportsController.js`
  - `server/src/routes/maintenanceRoutes.js`
- Client:
  - `client/src/services/maintenance.js`
  - `client/src/pages/Inventory/Inventory.jsx`
  - `client/src/components/Badge/Badge.jsx`, `client/src/i18n/translations.js`

**What changed**

Before this change, passing the final inspection put the weapon
straight back to **Available**. The new flow is:

```
Damaged → Maintenance (Pending → In Progress → Completed)
        → final inspection PASSED → READY FOR STOCK
        → Inventory Officer clicks "Return to Stock", picks a storage location
        → AVAILABLE (can be issued again)
```

- On the Maintenance tab, a passed record shows a **Ready for Stock**
  badge and a highlighted **Return to Stock** button.
- The button opens the record with a **Storage Location** dropdown.
- The weapon can't be issued while it's Ready for Stock.
- Returning it records **who** did it and **when**, sets its storage
  location, and restarts its 90-day inspection schedule (the final
  inspection counts as an inspection).
- The **Weapon Maintenance report** has a new "Returned to Stock"
  column, showing the date or "Awaiting".

**How it was done**

*1. A new state in the weapon's lifecycle.* The status enum got a new
value:

```js
status: { type: String, enum: ["available", "issued", "damaged", "missing", "ready_for_stock"], default: "available" },
```

and the maintenance record got two audit fields:

```js
returnedToStockAt: { type: Date, default: null },
returnedToStockBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
```

*2. Completing maintenance no longer makes the weapon available:*

```js
if (record.finalInspectionPassed) {
  item.status = "ready_for_stock";   // was: item.status = "available"
}
```

*3. A new endpoint does the final step:* `POST /api/maintenance/:id/return-to-stock`
(Inventory Officer only). It checks everything is in the right state
before changing anything:

```js
if (!storageLocation || !STORAGE_LOCATIONS.includes(storageLocation)) return 400 "Choose where the weapon is being stored";
if (record.status !== "completed" || record.finalInspectionPassed !== true) return 400;
if (record.returnedToStockAt) return 400 "already been returned to stock";
if (item.status !== "ready_for_stock") return 400;

item.status = "available";
item.storageLocation = storageLocation;
item.lastInspectionDate = record.completionDate;
item.nextInspectionDate = completionDate + 90 days;
record.returnedToStockAt = new Date();
record.returnedToStockBy = req.user.uid;
logAuditForActor(req, { action: `Returned ${item.itemId} to stock after Maintenance ${record.refId} — stored at ${storageLocation}` });
```

(Simplified; see `returnToStock()` in `maintenanceController.js`.)

*4. Closing the gaps so the new state is respected everywhere:*
- `issue()` on the server refuses `ready_for_stock`, with its own
  message: "passed maintenance but hasn't been returned to stock yet".
- The Issue form's weapon picker hides it:
  `!["damaged", "missing", "ready_for_stock"].includes(i.status)`.

*5. Client: one helper decides when to show the button:*

```js
function isAwaitingStock(record) {
  return record.status === "completed" && record.finalInspectionPassed === true
    && !record.returnedToStockAt && record.itemId?.status === "ready_for_stock";
}
```

That helper drives:
- the table badge (`<Badge status="ready_for_stock" />`);
- the button label ("Return to Stock" vs "View");
- the modal footer;
- the storage-location section in the modal.

The Badge component got a colour for the new status
(`ready_for_stock: "warning"`), and `translations.js` got its label
("Ready for Stock" / "තොගයට යැවීමට සූදානම්").

*6. Handling records from before this change.* Maintenance completed
earlier had already set its weapon to "available". To stop those rows
showing a pointless "Return to Stock" button, the maintenance list now
also sends the weapon's current status (`populate("itemId", "itemId itemName category status")`),
and `isAwaitingStock` requires `itemId.status === "ready_for_stock"`.

*7. Tested* on a throwaway server and database. 14 checks passed:
- the fault reason flows into the maintenance record;
- the weapon can't be returned to stock before completion;
- passed → Ready for Stock, and it can't be issued in that state;
- a storage location is required, and unknown ones are rejected;
- regular officers are forbidden;
- the weapon becomes available at the chosen location with its
  inspection rescheduled;
- it can't be returned twice;
- the "returned by" name is recorded;
- it's issuable again;
- the report shows the date.

**Techniques used**
- **Explicit state machine.** Each status is a clear stage, and each
  transition has exactly one allowed entry point. The new
  `ready_for_stock` state separates "repaired" from "physically back in
  the armory". Those are two different real-world facts, so they
  deserve two states.
- **Precondition checks (guarding transitions).** The endpoint checks
  every condition before changing anything: record completed, passed,
  not already returned, weapon in the right state. Invalid transitions
  are rejected rather than corrupting data.
- **Idempotency protection.** The "already returned" check means a
  double-click or repeated request can't process the same return twice.
- **Audit fields.** `returnedToStockAt` and `returnedToStockBy` answer
  "who did this and when?", which is the accountability requirement of
  the workflow spec.
- **One helper for one decision.** `isAwaitingStock()` is used in four
  places in the UI. If the rule changes, only one function changes.
- **Handling legacy data.** When introducing a new state, think about
  records created before it existed. Here the weapon's real status is
  the tie-breaker.
- **Updating every consumer of a value.** Adding an enum value means
  finding every place that checks the status (issue validation, the
  issue picker, badges, translations) and deciding how each should
  treat it.

---

### 14. Issue date & time recorded automatically (real time)

**Files:** `server/src/controllers/inventoryController.js`,
`client/src/pages/Inventory/Inventory.jsx`, `client/src/i18n/translations.js`

**What changed**
- The editable **Deployment Date** field on the Issue Item form was
  replaced by a read-only **Issue Date & Time** field showing the
  current date and time ("Recorded automatically at the moment you
  confirm").
- The **server** now stamps the exact moment of the issue itself. This
  applies to the weapon and the rounds issued with it, which share one
  record. Nothing the form sends can change it.
- **Times now show in local Sri Lanka time.** Before, the Issuing Log
  showed "00:00" on every row. The form only sent a date, which was
  saved as midnight UTC, and the display cut the hours straight out of
  the UTC timestamp.
- **Older records** saved with only a date now show just the date
  instead of a misleading "00:00".

**How it was done**

*1. Server: ignore the client, use the clock.* `dateTime` was removed
from what `issue()` reads out of the request body:

```js
// before
const issueDateTime = dateTime ? new Date(dateTime) : new Date();
// after
const issueDateTime = new Date();   // the real moment, stamped by the server
```

*2. Client: the date input became a read-only display.* The
`deploymentDate` form state and the `dateTime` it used to send were
removed:

```jsx
<InputField
  label={t("inventory.issuedAt")}
  readOnly
  value={formatDateTime(new Date().toISOString())}
  helperText={t("inventory.issuedAtHelper")}
/>
```

*3. Fixed the time display.* The old helper sliced characters out of
the UTC text (`value.slice(11, 16)`). The new one reads the time in the
browser's local timezone, and recognises old date-only records:

```js
function formatDateTime(value) {
  const d = new Date(value);
  // exactly midnight UTC = an old record that only ever had a date
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return formatDate(value);
  }
  return `${dd}/${mm}/${yyyy} ${d.getHours()}:${d.getMinutes()}`;   // local time (zero-padded in the real code)
}
```

This helper is used across the Inventory page, so alert times,
confirmation times and "Returned to Stock" times now also show in local
time.

*4. Tested:*
- An issue request that tried to send `dateTime: "2020-01-01"` was
  stamped with the real current time instead.
- With the timezone set to Asia/Colombo, `2026-09-23T09:15Z` displays
  as `23/09/2026 14:45`, and an old midnight-UTC record displays as
  `23/09/2026`.

**Techniques used**
- **Server-side timestamps.** When a time must be trustworthy (an
  audit or accountability record), the server sets it with its own
  clock. Anything the browser sends can be wrong (a bad PC clock) or
  deliberately faked.
- **Storing UTC, displaying local.** Databases store moments in UTC (the
  `Z` in `2026-09-23T09:15:00.000Z`). Convert to the viewer's local time
  only when *displaying*. `getHours()` gives local time; `getUTCHours()`
  gives UTC.
- **Dates vs moments.** A leave start date is a *calendar day* (the
  shared `formatDate` deliberately uses UTC so the day never shifts). An
  issue time is a *precise moment* (use local time). Pick the right
  treatment for each.
- **Don't parse dates as strings.** Slicing characters out of a
  timestamp ignores timezones. Use the `Date` object's methods.
- **Read-only display of system values.** Showing the value (rather
  than hiding the field) tells the user what will be recorded, while
  making clear they can't change it.
- **Graceful handling of old data.** Midnight-UTC records are recognised
  and shown as date-only, instead of showing an invented "05:30".

---

### 15. Notifications page with source filter (replaces the Inventory "Alerts" tab)

**Files**
- Server: `server/src/models/Alert.js`, `server/src/controllers/alertsController.js`,
  `server/src/routes/alertRoutes.js`
- Client, new: `client/src/pages/Notifications/Notifications.jsx`, `Notifications.css`
- Client, changed:
  - `client/src/App.jsx`, `client/src/config/navConfig.js`,
    `client/src/components/NavIcon/NavIcon.jsx`
  - `client/src/components/NotificationBell/NotificationBell.jsx`
  - `client/src/services/alerts.js`, `client/src/pages/Inventory/Inventory.jsx`,
    `client/src/i18n/translations.js`

**What changed**
- **A new Notifications page** is in the sidebar (bell icon) for every
  role.
- **Source tabs across the top:** All · Inventory · Leave · Duty ·
  Complaints. Each shows a red count of its *open* notifications.
- **Filters:** Priority, Status (defaults to "Open only") and a search box.
- **Each row shows:**
  - date and time;
  - a coloured **source** badge;
  - priority;
  - title with the message underneath;
  - recipient (for roles that see other people's alerts);
  - status;
  - buttons: **Acknowledge → Mark Action Taken → Resolve**, plus
    **Open**, which jumps to the related page (Inventory, My Weapons,
    Leave, Duty Roster, Complaints).
- **Live updates:** the list reloads when a new alert arrives, using
  the same live push as the bell.
- **The bell:** "View all" opens this page. Clicking one alert in the
  bell opens the page already filtered to that alert's source.
- **Inventory page:** the old **Alerts tab was removed**, because this
  page replaces it.

**Who sees what** (decided by the server):

| Role | Sees |
|---|---|
| OIC | Every alert at the station |
| Inventory Officer, Duty Officer | All inventory alerts at the station + alerts addressed to them |
| Officer, Admin | Only alerts addressed to them |

**Who can move an alert along:**
- the OIC, any alert;
- the Inventory Officer, inventory alerts;
- anyone, alerts addressed to them.

> Privacy improvement: the old Inventory Alerts tab loaded *every*
> station alert, which let inventory and duty officers see other people's
> leave decisions. The new feed only shows inventory alerts station-wide.

**How it was done**

*1. Every alert gets a source (server).* A lookup table maps each
`alertType` to where it comes from, and `toJSON()` adds it to every
alert sent to the browser:

```js
const ALERT_SOURCE_BY_TYPE = {
  weapon_issued: "inventory", low_ammo_stock: "inventory", /* …all inventory types… */
  leave_request_submitted: "leave", leave_approved: "leave", leave_rejected: "leave",
  roster_published: "duty",
  critical_complaint: "complaints",
};
function alertTypesForSource(source) {
  return Object.keys(ALERT_SOURCE_BY_TYPE).filter((type) => ALERT_SOURCE_BY_TYPE[type] === source);
}
alertSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.source = ALERT_SOURCE_BY_TYPE[obj.alertType] || "other";
  ...
};
```

The source is **computed, not stored**, so existing alerts in the
database got a source automatically, with no migration.

*2. One endpoint builds the right query per role:* `GET /api/alerts/feed`

```js
let visibility;
if (role === "oic") visibility = {};                                   // everything
else if (["inventory_officer", "duty_officer"].includes(role))
  visibility = { $or: [{ alertType: { $in: alertTypesForSource("inventory") } }, { recipientId: uid }] };
else visibility = { recipientId: uid };                                // only mine

const filter = { stationId, ...visibility };
if (req.query.source) filter.alertType = { $in: alertTypesForSource(req.query.source) };
```

*3. Permission to update was tightened to match:*

```js
const isOic = req.user.role === "oic";
const isInventoryAlertForInventoryOfficer =
  req.user.role === "inventory_officer" && alertTypesForSource("inventory").includes(alert.alertType);
const isRecipient = String(alert.recipientId) === String(req.user.uid);
if (!isOic && !isInventoryAlertForInventoryOfficer && !isRecipient) return 403;
```

*4. The page (client).* It loads the feed once and filters in the
browser, so switching tabs is instant. Tab counts come from one
`reduce`:

```js
const openCountBySource = SOURCES.reduce((acc, s) => {
  acc[s] = openAlerts.filter((a) => a.source === s).length;
  return acc;
}, {});
```

Live updates reuse the existing server-push stream:

```js
useEffect(() => {
  const stream = openNotificationStream();
  if (!stream) return;
  stream.onmessage = () => load();
  return () => stream.close();   // cleanup when leaving the page
}, [load]);
```

*5. The bell passes the source through router state:*

```js
navigate("/notifications", { state: source ? { source } : undefined });
// the page reads it as its starting filter:
const [source, setSource] = useState(SOURCES.includes(location.state?.source) ? location.state.source : "all");
```

*6. Sidebar and routing:*
- One `{ key: "notifications", ... }` entry was added to each role in
  `navConfig.js`.
- A bell shape was added to `NavIcon`.
- A `/notifications` route with no role restriction was added in
  `App.jsx`.

*7. The old Inventory Alerts tab was removed completely:* its tab entry,
state, data loading, filters, columns, action modal and import.

*8. Tested* on a throwaway server and database, with sample alerts of
every source:
- each role sees exactly the alerts in the table above;
- the source filter works, and unknown sources are rejected;
- every alert is tagged with its source;
- the update permissions allow and block the right people.

All 14 checks passed.

**Techniques used**
- **Computed fields in `toJSON`.** Deriving `source` from `alertType`
  when sending, instead of storing it, means old records work and the
  mapping lives in one place.
- **Server-side authorisation by building the query.** Visibility is
  enforced *in the database query* (`$or`, `recipientId`), so a user
  can never receive rows they shouldn't see, no matter what the client
  asks for.
- **Consistency between "see" and "act" rules.** Whoever may *update*
  an alert matches whoever should *see* it. Mismatched rules are a
  common source of security bugs.
- **Load once, filter in the browser.** For a few hundred rows,
  fetching once and filtering with `.filter()` makes tabs and filters
  instant, with no extra server round-trips.
- **`reduce` for counting per group.** It builds an object like
  `{ inventory: 3, leave: 1, ... }` in one pass.
- **Router state for passing context between pages.**
  `navigate(path, { state })` hands data to the next page without
  putting it in the URL.
- **`useEffect` cleanup.** Returning `() => stream.close()` closes the
  live connection when you leave the page, which prevents leaks and
  duplicate listeners.
- **Consolidation.** One place for all notifications replaces alerts
  scattered across pages. Remove the old version fully so there aren't
  two ways to do the same thing.

---

### 16. Removed the notification bell from the top bar

**Files**
- Deleted: `client/src/components/NotificationBell/` (`NotificationBell.jsx` + `NotificationBell.css`)
- Changed: `client/src/layouts/DashboardLayout.jsx`, `client/src/components/index.js`,
  `client/src/components/NavIcon/NavIcon.jsx`, `client/src/services/notificationStream.js`,
  `client/src/i18n/translations.js`

**What changed**
- The bell icon with its red count, next to the user's name in the top
  bar, is gone. Notifications now live only on the **Notifications**
  page in the sidebar (entry 15), which does everything the bell's
  dropdown did and more.

**How it was done**

*1. Found every place that used it* before deleting anything:

```bash
grep -rn "NotificationBell\|notif-bell" client/src
```

It was used in only one place (`DashboardLayout.jsx`), plus the
component barrel file `components/index.js`.

*2. Removed the usage, then the export, then the files:*

```jsx
// DashboardLayout.jsx
import { GlobalSearch, NavIcon } from "../components";   // NotificationBell removed from the import
...
<NotificationBell />                                      // ← line deleted from the top bar
```

```js
// components/index.js
export { NotificationBell } from "./NotificationBell/NotificationBell";   // ← deleted
```

```bash
git rm -r client/src/components/NotificationBell
```

*3. Cleaned up what was left behind:*
- the two translation keys only the bell used (`notifications.empty`,
  `notifications.viewAll`) in English and Sinhala;
- two code comments that still mentioned the bell.

The live-update stream (`notificationStream.js`) was **kept**, because
the Notifications page still uses it. Only its comments were updated.

*4. Verified:* `npx eslint src` (no errors or unused imports) and
`vite build` both passed.

**Techniques used**
- **Search before you delete.** Finding every reference first shows
  exactly what depends on the thing you're removing, so nothing breaks
  unexpectedly.
- **Remove from the outside in.** Take out the usage, then the export,
  then the files. At each step the app still compiles, and the linter
  flags anything missed.
- **Barrel files (`components/index.js`).** Many components are
  exported from one index file so pages can
  `import { A, B } from "../components"`. When you delete a component,
  remove its line there too, or the build fails.
- **Keep shared dependencies.** The live-update stream was used by both
  the bell and the new page, so only the bell-specific parts were
  removed.
- **`git rm`** deletes the files and records the deletion for the next
  commit.

---

### 17. Sidebar label showed "nav.notifications"

**File:** `client/src/i18n/translations.js`

**What changed:** the new Notifications link in the sidebar showed the
raw text **nav.notifications**. It now reads **Notifications** in
English and **දැනුම්දීම්** in Sinhala.

**How it was done:** the sidebar builds each link's name from the
translation file using the link's `key` from `navConfig.js`:

```jsx
// DashboardLayout.jsx
{t(`nav.${item.key}`)}     // key "notifications" -> looks up nav.notifications
```

Entry 15 added the link (`key: "notifications"`) but not its entry in
the `nav` section, so the lookup failed. The translation function then
falls back to showing the key itself. One line was added to each
language's `nav` section:

```js
nav: {
  ...
  "weapon-management": "My Weapons",
  notifications: "Notifications",        // English
},
nav: {
  ...
  "weapon-management": "මගේ ආයුධ",
  notifications: "දැනුම්දීම්",            // Sinhala
},
```

**Techniques used**
- **Recognising a missing translation.** When the screen shows a
  dotted path like `nav.notifications`, the lookup key has no text
  behind it. Search the translation file for that section and add the
  key.
- **Convention-based lookups.** The label key is built from the nav
  item's `key` (`nav.${item.key}`). Adding a new nav item therefore
  always needs two things: an entry in `navConfig.js` **and** a matching
  `nav.<key>` in *every* language.
- **Lesson from this bug:** when adding anything with a visible label,
  add its translation in all languages in the same change.

---

### 18. Itemised parts list and cost in Manage Maintenance

**Files**
- Server: `server/src/models/Maintenance.js`,
  `server/src/controllers/maintenanceController.js`,
  `server/src/controllers/reportsController.js`
- Client, new: `client/src/pages/Inventory/MaintenancePartsEditor.jsx`,
  `client/src/pages/Inventory/maintenanceParts.js`
- Client, changed: `client/src/pages/Inventory/Inventory.jsx`, `Inventory.css`,
  `client/src/i18n/translations.js`

**What changed**
- The single free-text **Parts / Cost** box was replaced by a **Parts
  Used** list.
- **Each row** has a part name, quantity and unit cost (LKR), and
  shows its own total.
- **Adding and removing rows:** "+ Add Part" adds a row and "×" removes
  one.
- **Grand total:** a **Total Cost** is shown under the list and updates
  as you type.
- **Part name suggestions:** common weapon parts (Firing Pin, Recoil
  Spring, Extractor, Magazine Spring, ...) are suggested while you type.
  Any other name can still be entered.
- **After completion:** the list becomes read-only, and the server
  refuses changes.
- **Maintenance table:** a new **Total Cost** column.
- **Weapon Maintenance report:** new **Parts** ("2 × Firing Pin;
  1 × Recoil Spring") and **Total Cost (LKR)** columns.
- **Older records:** whatever was typed in the old box is still shown,
  as an "Earlier note".
- **On a phone:** each part's fields stack neatly instead of squeezing
  five columns side by side.

**How it was done**

*1. An array of sub-documents in the schema.* One maintenance record
holds many parts:

```js
parts: {
  type: [{
    _id: false,
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
  }],
  default: [],
},
totalCost: { type: Number, default: 0, min: 0 },
```

*2. The server validates every row and calculates the total itself:*

```js
function cleanParts(parts) {
  if (!Array.isArray(parts)) return { error: "Parts must be a list" };
  for (const [i, part] of parts.entries()) {
    if (!name) return { error: `Part ${i + 1}: enter the part name` };
    if (!Number.isInteger(quantity) || quantity < 1) return { error: `Part ${i + 1}: quantity must be a whole number of 1 or more` };
    if (!Number.isFinite(unitCost) || unitCost < 0) return { error: `Part ${i + 1}: unit cost must be 0 or more` };
    cleaned.push({ name, quantity, unitCost: Math.round(unitCost * 100) / 100 });
  }
  const totalCost = Math.round(cleaned.reduce((sum, p) => sum + p.quantity * p.unitCost, 0) * 100) / 100;
  return { parts: cleaned, totalCost };
}
```

Parts are locked once the record is `completed`.

*3. A separate, reusable component for the rows*
(`MaintenancePartsEditor.jsx`). The parent owns the data (`rows`) and the
component reports changes through `onChange`:

```jsx
function updateRow(index, field, value) {
  onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));   // change one row
}
function removeRow(index) {
  onChange(rows.filter((_, i) => i !== index));                                       // drop one row
}
// add:  onChange([...rows, { ...EMPTY_PART }])
```

The grand total is **derived** on every render, not stored:

```js
const grandTotal = rows.reduce((sum, row) => sum + lineTotal(row), 0);
```

Name suggestions use the browser's built-in `<datalist>`:

```jsx
<input list="common-weapon-parts" ... />
<datalist id="common-weapon-parts">
  {COMMON_WEAPON_PARTS.map((p) => <option key={p} value={p} />)}
</datalist>
```

*4. Helper functions moved to their own file* (`maintenanceParts.js`):
`EMPTY_PART`, `formatLkr`, `lineTotal` and `partsForSubmit`. ESLint's
`react-refresh/only-export-components` rule flagged them when they sat
in the component file.

*5. Converting form strings to numbers before sending.* `partsForSubmit`
skips completely blank rows and reports the row number of a
half-filled one ("Part 2: fill in the name, ...").

*6. Money formatting:*

```js
`LKR ${Number(amount).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`   // "LKR 6,250.50"
```

*7. Responsive CSS grid.* Five columns on a desktop. Under 600px the
name takes a full line and the rest go two per line:

```css
.parts-row { display: grid; grid-template-columns: minmax(0, 3fr) minmax(64px, 0.8fr) minmax(90px, 1.3fr) minmax(110px, 1.3fr) 32px; }
@media (max-width: 600px) {
  .parts-row { grid-template-columns: 1fr 1fr; }
  .parts-row > :first-child { grid-column: 1 / -1; }
}
```

*8. Tested* on a throwaway server and database. 9 checks passed:
- the total is calculated on the server (2 × 2500 + 1 × 1250.50 =
  6250.50);
- a total sent by the client is ignored;
- blank names, zero, fractional and negative values are all rejected;
- 3 × 0.10 comes out as exactly 0.30;
- parts are locked after completion;
- the report shows "2 × Firing Pin" and "5000.00".

**Techniques used**
- **Arrays of sub-documents (one-to-many inside one record).** Parts only
  make sense inside their maintenance record, so they're stored *in* it
  rather than in a separate collection.
- **Never trust totals from the client.** The browser shows a live
  total for convenience, but the server recalculates it from the rows.
  A user can't make the saved total disagree with the parts.
- **Rounding money to cents.** Computers can't store 0.1 exactly
  (`0.1 * 3 = 0.30000000000000004`). Rounding with
  `Math.round(x * 100) / 100` keeps amounts exact to the cent.
- **Controlled component with add/update/remove on an array.** `map`
  changes one item, `filter` removes, and spread `[...rows, x]` adds.
  Each creates a *new* array, so React re-renders.
- **Derived values.** Line totals and the grand total are computed from
  the rows every render, so they can never go stale.
- **Splitting large files.** The editor lives in its own file instead of
  growing `Inventory.jsx` further. That makes it easier to read, test
  and reuse.
- **`<datalist>` for suggestions.** It's a native HTML feature, so
  there's no library to install and you're not restricted to the list.
- **Keeping legacy data visible.** Old free-text notes still appear, and
  the report falls back to them.
- **Responsive design with CSS grid and a media query.** The same markup
  works on desktop and phone.

---

### 19. Issued ammunition count is fixed once issued

**Files:** `server/src/controllers/inventoryController.js`,
`client/src/pages/Inventory/Inventory.jsx`, `client/src/i18n/translations.js`

**What changed**
- The number of rounds recorded when a weapon is **issued can't be
  changed afterwards**. On the Return form:
  - **Ammunition Issued** is always read-only ("Fixed from the issue
    record"). Before, it could be edited when the issue had no rounds.
  - **Ammunition Returned** and **Rounds Declared Used** are capped at
    the issued number *while typing*. Type 25 when 20 were issued and it
    becomes 20. The helper text shows "max 20".
  - If **no rounds were issued** with the weapon, the ammunition fields
    are replaced by "No ammunition was issued with this weapon".
- **Issue form:** the rounds field is capped at what's left in the
  chosen ammunition batch.
- **Server:** the issued count comes *only* from the original issue
  record. Anything the form sends for "Ammunition Issued" is ignored. A
  return can't record rounds for a weapon issued without any.

**How it was done**

*1. Server: one source for the issued count.* `ammoIssued` is no longer
read from the request at all:

```js
// before: fell back to the form's value if the issue record had none
const issuedRounds = hasValue(sourceIssue?.ammoIssued) ? sourceIssue.ammoIssued : hasValue(ammoIssued) ? Number(ammoIssued) : null;

// after: only the issue record counts
const issuedRounds = hasValue(sourceIssue?.ammoIssued) && sourceIssue.ammoIssued > 0 ? sourceIssue.ammoIssued : null;
if (issuedRounds === null && ((returnedRounds ?? 0) > 0 || (declaredUsed ?? 0) > 0)) {
  return res.status(400).json({ error: "No ammunition was issued with this weapon" });
}
```

The existing checks ("returned/declared can't exceed issued") now always
compare against that fixed number.

*2. Client: a small clamping helper* keeps typed values within the
limit:

```js
function capRounds(value, max) {
  if (value === "") return "";                          // let the field be cleared
  const n = Math.max(0, Math.floor(Number(value)));     // no negatives, whole rounds only
  if (!Number.isFinite(n)) return "";
  return String(Number.isFinite(max) ? Math.min(n, max) : n);
}
// used in onChange:
onChange={(e) => setReturnForm((f) => ({ ...f, ammoReturned: capRounds(e.target.value, Number(f.ammoIssued)) }))}
```

The inputs also get `max={returnForm.ammoIssued}` so the arrow buttons
stop at the limit.

*3. Read-only issued field and a "no ammo" message* using conditional
rendering:

```jsx
{returnForm.item && !(Number(returnForm.ammoIssued) > 0) ? (
  <p>{t("inventory.noAmmoIssued")}</p>
) : (
  <InputField label={t("inventory.ammoIssued")} readOnly value={returnForm.ammoIssued} ... />
  ...
)}
```

The return request no longer sends `ammoIssued` at all.

*4. Tested:*
- Server, on a throwaway server and database (all passed):
  - returning 25 of 20 issued is refused;
  - a form value of 500 for "issued" is ignored and 20 is used;
  - claiming rounds back for a weapon issued without ammo is refused;
  - a plain return without ammo works.
- The helper function:
  - `capRounds("25", 20)` → 20
  - `"-3"` → 0
  - `"7.9"` → 7
  - `""` → `""`
  - no limit → unchanged

**Techniques used**
- **Immutable records / single source of truth.** Once a fact is
  recorded (rounds issued), later steps *read* it and never re-enter it.
  Letting a later form retype it creates two versions of the truth.
- **Don't accept what you don't need.** The server stopped reading
  `ammoIssued` from the return request entirely. A value that isn't read
  can't be tampered with.
- **Clamping input as you type.** Correcting the value in `onChange`
  gives instant feedback, better than an error after pressing Submit. The
  server check stays as the real guarantee.
- **`max` attribute + clamping together.** `max` guides the number
  spinner, but typing can still exceed it, so the `onChange` clamp
  enforces it.
- **Handling the "nothing to do" case explicitly.** Showing "No
  ammunition was issued" is clearer than showing empty fields that
  can't be used.

---

### 20. Weapon ID and Item ID limited to exactly 5 digits

**Files:** `server/src/controllers/inventoryController.js`,
`client/src/pages/Inventory/Inventory.jsx`, `client/src/i18n/translations.js`

> **Related manual change (made by you):** the "Serial Number" label was
> renamed to **Item ID** (Sinhala: **භාණ්ඩ අංකය**) by editing the text
> of `colSerialNumber` in `translations.js`. The database field is
> still called `serialNumber`. Only the label on screen changed.

**What changed**
- On the **Add New Item** form, for weapons, **Weapon ID** and **Item
  ID** must each be **exactly 5 digits** (e.g. `12345`).
- The boxes only accept numbers and stop at 5 characters. Typing
  `12a3-45678` gives `12345`.
- Each box shows "12345" as a placeholder and "Exactly 5 digits" under
  it.
- Submitting with fewer than 5 digits shows "Weapon ID and Item ID must
  each be exactly 5 digits."
- The **server** enforces the same rule. The error messages now say
  "Item ID" instead of "serial number", to match the label.
- **Ammunition batch IDs** keep their free format (e.g. `AM-9MM-01`).
- **Existing items** with longer IDs (e.g. 34556677) are not changed.
  The rule applies to new registrations.

**How it was done**

*1. A regular expression defines the rule, the same on both sides:*

```js
const WEAPON_ID_PATTERN = /^\d{5}$/;   // server
const FIVE_DIGITS = /^\d{5}$/;         // client
```

`^` means the start, `\d{5}` means exactly five digits, and `$` means
the end. Without `^` and `$`, "abc12345xyz" would also match.

*2. Cleaning the input as you type (client):*

```js
function toFiveDigits(value) {
  return value.replace(/\D/g, "").slice(0, 5);   // \D = any non-digit, g = all of them
}
onChange={(e) => setAddForm((f) => ({ ...f, serialNumber: toFiveDigits(e.target.value) }))}
```

The Weapon ID box only applies this when the category isn't Ammunition,
so batch IDs can still contain letters.

*3. A check before submitting (client) and a check on the server:*

```js
// server, in create()
if (!isAmmunition) {
  if (!WEAPON_ID_PATTERN.test(String(itemId))) return 400 "Weapon ID must be exactly 5 digits";
  if (!WEAPON_ID_PATTERN.test(String(serialNumber).trim())) return 400 "Item ID must be exactly 5 digits";
}
```

*4. Tested* on a throwaway server and database. 8 checks passed:
- 4-digit, 6-digit and lettered Weapon IDs are rejected;
- 3-digit and lettered Item IDs are rejected;
- 5 + 5 digits are accepted;
- a duplicate Item ID is rejected;
- an ammunition batch ID like `AM-9MM-01` is still accepted.

**Techniques used**
- **Regular expressions for format rules.** One short pattern
  (`/^\d{5}$/`) describes "exactly five digits". Anchors (`^...$`) make
  it match the whole value, not just part of it.
- **Input sanitising vs validation.** *Sanitising* (`toFiveDigits`)
  quietly fixes what's typed. *Validation* (`FIVE_DIGITS.test`, the
  server check) refuses what's still wrong. Use both: sanitising for a
  smooth form, validation as the real rule.
- **`replace(/\D/g, "")`.** A common way to keep only the digits from a
  string.
- **Applying a rule only where it belongs.** Checking `isAmmunition`
  keeps the 5-digit rule to weapons and leaves ammunition batch IDs
  alone.
- **Rules apply going forward.** New validation doesn't retroactively
  break old records. Existing longer IDs still load and display fine.
- **Keeping messages consistent with labels.** When a label is renamed,
  update error messages that mention it too.

---

### 21. Fixed the root `.gitignore` (and ignore macOS `.DS_Store` files)

**Date:** 2026-09-24

**File:** `COPSYS/.gitignore` (the repository root, one level above the project folder)

**What changed**
- **A broken file.** The root `.gitignore` had a hidden problem: the
  `.env` and `dist/` lines started with 3 spaces, and the file ended
  with stray spaces and no final line break. Git treats leading spaces
  as part of the pattern, so **those two rules never matched anything**.
  (Secrets were still safe, because `client/` and `server/` each have
  their own working `.gitignore` that ignores `.env`.)
- **Mac junk files.** macOS creates a hidden `.DS_Store` file in every
  folder you open in Finder (it stores icon positions and view
  settings). Git was listing two of them as new files, ready to be
  uploaded to GitHub on the first "commit all".
- **The fix:** the file was rewritten cleanly with a `.DS_Store` rule
  added:

```
node_modules/
.env
dist/
.DS_Store
```

**How it was done**

*1. Noticed it didn't work:* after adding `.DS_Store`, `git status`
still listed the files.

*2. Looked at the raw bytes* to see characters that are otherwise
invisible:

```bash
od -c .gitignore
# 0000000  n o d e _ m o d u l e s / \n _ _ _ . e n v \n _ _ _ d i s t / \n _ _ _
#          (each _ here is a space the editor doesn't show)
```

*3. Rewrote the file* with exactly one pattern per line and a final
newline, then confirmed with `git check-ignore`:

```bash
printf 'node_modules/\n.env\ndist/\n.DS_Store\n' > .gitignore
git check-ignore -v .DS_Store        # -> .gitignore:4:.DS_Store  .DS_Store
```

**Techniques used**
- **`.gitignore`.** A list of file patterns git should pretend don't
  exist. It's the right place for machine-specific junk (`.DS_Store`),
  build output (`dist/`), downloaded packages (`node_modules/`) and
  secrets (`.env`).
- **Whitespace matters in config files.** A pattern with leading
  spaces is a *different* pattern. Invisible characters are a classic
  cause of "my config isn't working".
- **`od -c` to see hidden characters.** It prints every byte, so
  spaces, tabs and missing newlines become visible.
- **Verify, don't assume.** `git check-ignore -v <file>` tells you
  exactly which rule (file and line) ignores a file, or prints nothing
  if none does.
- **Check before committing secrets.** Before the first push,
  `git check-ignore -v server/.env client/.env` confirmed both `.env`
  files (database settings, JWT secret, Gmail app password) are ignored,
  so they won't reach GitHub.
- **`>` vs `>>` in the shell.** `>` replaces a file's contents (used
  here on purpose, to rewrite it cleanly). `>>` appends to the end.
