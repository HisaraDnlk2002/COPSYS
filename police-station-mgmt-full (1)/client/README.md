# Police Station Management System — Client

React frontend. Currently wired to **dummy data** so you can build every
screen without waiting on the backend.

## Running it

```
npm install
npm run dev
```

## Test logins (dummy data)

| Username | Password     | Role               |
|----------|--------------|--------------------|
| 77412    | admin123     | admin              |
| 88214    | oic123       | oic                |
| 91022    | duty123      | duty_officer       |
| 73310    | inv123       | inventory_officer  |
| 65521    | officer123   | officer            |

## How the dummy-data layer works

- `src/services/dummyData.js` — fake records shaped exactly like the real
  API responses will be (see `ARCHITECTURE.md` Section 2 for the schema).
- `src/services/config.js` — one flag, `USE_DUMMY_DATA`. Every file in
  `services/` checks it.
- Every function in `services/*.js` (e.g. `loginRequest`, `getMyProfile`,
  `listUsers`) has the exact same signature whether `USE_DUMMY_DATA` is
  true or false. Components never know or care which one is active.

## Switching to the real backend

1. Confirm the actual request/response shape with your teammate for each
   endpoint (their MongoDB/JWT backend may not match the commented-out
   `api.get(...)` / `api.post(...)` calls exactly — update those lines).
2. Set `USE_DUMMY_DATA = false` in `src/services/config.js`.
3. Set `VITE_API_BASE_URL` in `.env` to wherever their Express server runs
   (e.g. `http://localhost:5000/api`).
4. Test each screen one at a time — Login first, then Dashboard, then the
   rest — rather than flipping everything at once.

## Folder structure

```
src/
  auth/         AuthContext (current user/role), ProtectedRoute
  components/   shared UI pieces (build these next: Button, Card, Table, etc.)
  config/       navConfig.js — left-nav items per role
  layouts/      DashboardLayout (sidebar + topbar shell)
  pages/        one folder per screen (Login, Dashboard, ...)
  services/     all data access — the ONLY place that knows about dummy
                vs. real data
```
