# Police Station Management System — Server

Express API backed by **MongoDB** with **JWT** authentication (bcrypt for
password hashing). Matches the schema and routes in `ARCHITECTURE.md`.

## 1. Get a MongoDB database

Pick ONE:

**Option A — MongoDB Atlas (free, no install, easiest):**
1. Go to https://www.mongodb.com/cloud/atlas/register and create a free account
2. Create a free "M0" cluster (any region close to you)
3. Under "Database Access", create a username + password
4. Under "Network Access", add your IP (or `0.0.0.0/0` for "allow from anywhere" while developing)
5. Click "Connect" on your cluster → "Drivers" → copy the connection string,
   it looks like:
   `mongodb+srv://<username>:<password>@<cluster>.mongodb.net/police-station-mgmt`

**Option B — Install MongoDB locally:**
- Download from https://www.mongodb.com/try/download/community
- Once installed and running, your connection string is just:
  `mongodb://localhost:27017/police-station-mgmt`

## 2. Configure environment variables

```
cp .env.example .env
```

Open `.env` and set:
- `MONGO_URI` — the connection string from step 1
- `JWT_SECRET` — any long random string (the `.env.example` file shows a command to generate one)

## 3. Install and run

```
npm install
npm run dev
```

You should see:
```
MongoDB connected
Server running on http://localhost:5000
```

If you see a MongoDB connection error instead, double check `MONGO_URI` —
this is almost always a copy-paste issue with the password or a missing
"allow my IP" step in Atlas.

## 4. Create your starter accounts

The "create personnel" route requires you to already be logged in as an
admin — so for the very first accounts, run the seed script instead:

```
node src/seed.js
```

This creates one account per role:

| Username | Password   | Role               |
|----------|-----------|--------------------|
| 77412    | admin123   | admin              |
| 88214    | oic123     | oic                |
| 91022    | duty123    | duty_officer       |
| 73310    | inv123     | inventory_officer  |
| 65521    | officer123 | officer            |

It also creates a default `SystemSettings` document so OIC's Settings
screen has something to show on first load.

**Change these passwords** once you've logged in (a "change password"
route isn't built yet — flagged as a TODO; for now you'd update directly
in the database).

Log in as `77412` (admin) to create real personnel, or log in as `88214`
(OIC) to see the Command Dashboard, Leave Management, Reports, and
Settings screens.

## 5. Testing the API directly (optional, before connecting the frontend)

With the server running, try this in a terminal:

```
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"77412","password":"admin123"}'
```

You should get back `{ "token": "...", "user": { ... } }`. Copy the token
and try a protected route:

```
curl http://localhost:5000/api/users \
  -H "Authorization: Bearer PASTE_TOKEN_HERE"
```

You should get back a list containing the admin user you just created.

## Folder structure

```
src/
  config/db.js          MongoDB connection
  models/                Mongoose schemas (User, LeaveRequest, Complaint, ...)
  middleware/
    verifyToken.js       checks the JWT on protected routes
    requireRole.js       restricts a route to specific roles
  controllers/           the actual logic per resource
  routes/                URL -> controller wiring, with middleware applied
  seed.js                one-time script to create the first admin
  index.js               app entry point
```

## What's NOT built yet (flagged honestly)

- Password reset / change-password flow
- Email or SMS notifications (e.g. leave approved/rejected) — the toggles
  exist in Settings, but nothing actually sends anything yet
- File upload for medical certificates (needs a storage solution — not in scope yet)
- Automatic leave-balance reset at year boundary
- Rate limiting / brute-force login protection
- Reports activity log (`GET /api/reports/activity-log`) returns an empty
  list — real PDF/CSV report generation isn't implemented
- RBAC settings (`/api/settings`) are stored and returned, but route
  guards (`requireRole`) are still hardcoded constants, not read from
  this config. Toggling a checkbox in Settings won't yet change what a
  Sergeant can actually do — see ARCHITECTURE.md open items.

These weren't in the current build step's scope — flag if you want any of
them prioritized next.
