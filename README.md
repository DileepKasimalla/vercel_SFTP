# FedEx SFTP Portal

A two-door file distribution portal: an **administrator** publishes files and manages
accounts, and **users** sign in to collect the files shared with them.

- **Backend** — Python 3.11+ / FastAPI, SQLAlchemy, JWT auth
- **Frontend** — React 18 + TypeScript, Vite, React Router
- **Database** — local Postgres in development, Neon on Vercel
- **Storage** — a folder on disk in development, Vercel Blob in production

Both swaps are automatic: the app reads `DATABASE_URL` and picks Blob storage as soon as
`BLOB_READ_WRITE_TOKEN` is present.

---

## What the portal does

**1. First run — bootstrap.** A portal with no administrator sends every visitor to
`/bootstrap`, where the first admin account is created. The endpoint closes permanently the
moment an admin exists, and a second attempt returns `409`.

**2. Admin login** (`/admin/login`) opens a dashboard with two tabs:

- **Users** — create accounts (with a generated or a typed password), reset any user's
  password, disable/enable, delete. Issued passwords are shown exactly once, with a copy
  button.
- **Files** — drag-and-drop or browse to upload **one or many files at a time**, optionally
  with a note. Files go to every user by default, or you can target specific users. The tab
  also lists everything published, with download and delete.

**3. User login** (`/login`) opens a dashboard listing the files shared with that user, each
with a Download button. Users who are still on an admin-issued password are prompted to set
their own.

**4. File lifecycle.** Two rules run automatically:

- **A PDF leaves your dashboard once you download it.** Collecting a PDF removes it from
  *that* user's list for good — other recipients keep seeing their copy, and nothing is
  deleted early. Non-PDF files stay listed after download. An admin opening a file does not
  count as collecting it.
- **Every file is deleted 5 days after upload**, downloaded or not. This is a real delete:
  the database row and the stored object both go. Set `RETENTION_DAYS` to change the window.

Retention is enforced from two directions, so it holds on a busy portal and an idle one:
every file listing purges what has expired, and a daily Vercel Cron job calls
`/api/maintenance/cleanup`.

Admin and user credentials are not interchangeable: each login page only accepts its own
role.

---

## Project layout

```
backend/               the FastAPI application
  main.py              app assembly, CORS, /api/health
  config.py            environment variables -> settings
  db.py                engine/session; NullPool, since serverless freezes between calls
  models.py            users, files, file_assignments
  schemas.py           request/response models
  security.py          PBKDF2 hashing, JWT issuing, auth dependencies
  storage.py           local-folder and Vercel Blob backends behind one interface
  retention.py         the 5-day delete and the collected-PDF rule
  routes_auth.py       /api/bootstrap, /api/auth/*
  routes_admin.py      /api/admin/* (users + uploads)
  routes_files.py      /api/files/* (listing + download)
  routes_maintenance.py  /api/maintenance/cleanup (called by Vercel Cron)
api/
  index.py             Vercel entrypoint — a shim that exposes backend's ASGI `app`.
                       Vercel only builds functions from `api/`, so the real code
                       lives in backend/ and is bundled via `includeFiles`.
frontend/
  src/
    api.ts             typed fetch client
    auth.tsx           session context, token in localStorage
    pages/             Portal, Bootstrap, Login, AdminDashboard, UserDashboard
    components/        Shell, UsersPanel, FilesPanel, ChangePassword, ui helpers
tests/smoke_test.py    81-check end-to-end API test (SQLite, no services needed)
requirements.txt       runtime deps — this is the file Vercel installs
vercel.json            build + routing configuration
```

---

## Running locally

### 1. Database

```bash
createdb fedex_sftp
```

Tables are created automatically on the first request — there is no migration step.

### 2. Environment

```bash
cp .env.example .env
```

Then edit `.env` — at minimum set `DATABASE_URL` and a real `JWT_SECRET`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 3. Backend

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt    # Windows
# source .venv/bin/activate && pip install -r requirements-dev.txt  # macOS / Linux

.venv/Scripts/python.exe -m uvicorn backend.main:app --reload --port 8000
```

API docs: <http://127.0.0.1:8000/api/docs> · Health: `/api/health`

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to `127.0.0.1:8000`, so the frontend
calls the same paths locally and in production.

### 5. Tests

```bash
.venv/Scripts/python.exe tests/smoke_test.py
```

Runs the whole API against SQLite and a temp folder — bootstrap, both logins, role
boundaries, single/multi/targeted uploads, visibility rules, download tokens, password
resets, deletion, the collected-PDF rule and the 5-day retention sweep. No Postgres
required.

---

## Deploying to Vercel

### 1. Push the repo and import it

Import the project at <https://vercel.com/new>. `vercel.json` already sets the build
command, the output directory and the routing — leave the framework preset as **Other**.

### 2. Add the Neon database

In the project: **Storage → Create Database → Neon**. The integration injects
`DATABASE_URL` / `POSTGRES_URL` into every environment; the app reads whichever is present.
Prefer Neon's **pooled** connection string for serverless.

### 3. Add Blob storage

**Storage → Create Database → Blob**. This injects `BLOB_READ_WRITE_TOKEN`, which flips the
app from folder storage to Vercel Blob with no code change.

### 4. Set the remaining environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `JWT_SECRET` | **yes** | Long random string. Changing it signs everyone out. |
| `BOOTSTRAP_TOKEN` | recommended | When set, the bootstrap page also demands this value, so a stranger cannot claim the admin account on your public URL before you do. |
| `JWT_EXPIRE_MINUTES` | no | Session length, default `480`. |
| `MAX_UPLOAD_MB` | no | Per-file limit, default `4`. Keep it at or below `4` on Vercel. |
| `RETENTION_DAYS` | no | Days before a file is deleted, default `5`. |
| `CRON_SECRET` | recommended | Vercel sets this when you add a cron job; the cleanup endpoint requires it (an admin token also works). |
| `DOWNLOAD_TOKEN_SECONDS` | no | Download-link lifetime, default `120`. |
| `DATABASE_URL` | auto | From Neon. |
| `BLOB_READ_WRITE_TOKEN` | auto | From Blob. |

### 5. The cleanup cron

`vercel.json` already declares a daily job:

```json
"crons": [{ "path": "/api/maintenance/cleanup", "schedule": "0 3 * * *" }]
```

Vercel picks this up on deploy — nothing to configure. Set `CRON_SECRET` so the endpoint
cannot be hit by anyone else; Vercel sends it as `Authorization: Bearer $CRON_SECRET`
automatically. On the Hobby plan crons run once a day, which is ample for a 5-day window,
and file listings purge expired files anyway.

### 6. Deploy, then open the site

You land on `/bootstrap`. Create the administrator, and the portal is live.

---

## Things worth knowing

**Upload size on Vercel.** A serverless function's request body is capped at **4.5 MB**.
The browser therefore uploads each file separately and rejects files over **4 MB**, leaving
room for multipart and form-field overhead. Locally the limit is whatever you set. To move
larger files on Vercel you need client-side direct uploads to Blob (`@vercel/blob/client`),
which would replace the `POST /api/admin/files` handler with a token-issuing endpoint.

**Downloads.** A browser navigation cannot carry an `Authorization` header, so the client
first calls `POST /api/files/{id}/download-link`, which checks access and returns a URL
carrying a short-lived token bound to that one file. With Blob storage the download endpoint
then redirects to the blob's own URL — Blob URLs are public but unguessable, and redirecting
avoids the serverless response size cap.

**Passwords** are hashed with PBKDF2-HMAC-SHA256 (260k iterations) from the standard
library — no native wheels to build in the serverless bundle. Plaintext passwords are
returned exactly once, in the response to the create/reset call that generated them, and are
never stored.

**Retention is derived, not stored.** A file's deadline is computed as
`created_at + RETENTION_DAYS` rather than written into a column, so changing the setting
takes effect immediately for existing files and needs no migration.

**Collected PDFs are tracked in `file_downloads`**, one row per (file, user) pair. That is
what hides a PDF from one user without affecting anyone else, and it is what fills the
admin's "Collected" column.

**Schema changes.** `create_all` handles the initial schema but will not alter existing
tables. If you change `models.py` on a live database, add Alembic or apply the change by
hand.

**Local storage is not persistent on Vercel.** The filesystem there is read-only apart from
`/tmp`, which is why Blob is used in production. Keep `BLOB_READ_WRITE_TOKEN` set.

---

## API reference

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | anyone | Liveness, database and storage backend |
| `GET` | `/api/bootstrap/status` | anyone | Whether an admin still needs creating |
| `POST` | `/api/bootstrap` | anyone, once | Create the first admin, returns a session |
| `POST` | `/api/auth/login` | anyone | `{username, password, role}` |
| `GET` | `/api/auth/me` | signed in | Current account |
| `POST` | `/api/auth/change-password` | signed in | Self-service password change |
| `GET` | `/api/files` | signed in | Files visible to the caller |
| `POST` | `/api/files/{id}/download-link` | signed in | Short-lived download URL |
| `GET` | `/api/files/{id}/download?t=…` | token | The file itself |
| `GET` | `/api/admin/users` | admin | List accounts |
| `POST` | `/api/admin/users` | admin | Create a user, returns the password once |
| `PATCH` | `/api/admin/users/{id}` | admin | Update details, enable/disable |
| `POST` | `/api/admin/users/{id}/reset-password` | admin | Reset, returns the password once |
| `DELETE` | `/api/admin/users/{id}` | admin | Delete a user |
| `GET` | `/api/admin/files` | admin | Every published file |
| `POST` | `/api/admin/files` | admin | Multipart upload of one or many files |
| `DELETE` | `/api/admin/files/{id}` | admin | Delete a file and its stored object |
| `GET`/`POST` | `/api/maintenance/cleanup` | cron secret or admin | Delete every file past its retention window |
