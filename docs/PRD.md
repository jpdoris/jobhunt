# Job Hunting Dashboard — Product Requirements

A web app for tracking job applications, replacing a 291-row spreadsheet.
Runs locally in WSL today, with a path to public hosting later.

Decisions here are settled unless they appear under [Open Questions](#open-questions).
If a decision changes, edit it here rather than in a comment or commit message.

---

## Goals

1. Replace the spreadsheet without losing any data or capability.
2. Make the application history searchable, filterable, and countable at a glance.
3. Track what happens next for each application, and when.
4. Keep unemployment-insurance proof-of-search reporting easy.
5. Keep the resume and cover letter sent with each application attached to it.
6. Accumulate enough history to answer how the search is actually going —
   conversion rates, response times, and where applications stall.

## Non-Goals

These are explicitly out of scope. Revisit only by editing this section.

- **Sharing, collaboration, teams, or permissions.** The app supports multiple
  users, but each user's data is private and isolated. No user ever sees another's
  applications, and there are no roles or admin views.
- **Scraping or auto-importing postings.** Fetching a `job_posting_link` to fill in
  `description` was evaluated and rejected: the 275 seed links span 96 hosts, half
  of them JS-rendered or auth-walled, so it needs a headless browser plus per-host
  parsers that break on every redesign. Descriptions are pasted by hand.
- **Resume or cover-letter _generation_ or tailoring.** Storage is in scope
  (see [Documents](#documents)); writing the content is not.
- **Email integration of any kind.** No Gmail scanning, no parsing rejection emails,
  no inferring status from a mailbox. Status changes are entered by hand.
- **Two-way calendar sync.** Adding an interview to Google Calendar is in scope, but
  only as a one-way handoff — no OAuth, no stored tokens, no reading the calendar
  back, no updating or deleting events the app created.
- **A native mobile app.** The web UI is responsive; that is the whole mobile story.
- **Offline support / PWA.**

---

## Users & Authentication

The app is **multi-user by design**: every user has their own fully separate set of
applications. Only one account exists today (the owner's, created by the seed
process), but nothing may assume that.

Authentication is required even while the app is local-only, since it may be exposed
publicly later and retrofitting auth tends to leak.

- **Mechanism:** `nuxt-auth-utils` with sealed session cookies.
- **Credentials:** password hash stored in the `user` table.
- **Account creation is CLI-only.** `npm run user:create` adds an account. There is
  no signup page, no invite flow, and no self-registration endpoint — a public
  signup form is attack surface with no user behind it. Do not add one.
- Adding an OAuth provider later is additive and must not require a data migration.

### Password policy

**Creating and resetting are separate commands**, and neither asks for the old
password:

```
npm run user:create you@example.com     fails if the email already exists
npm run user:reset  you@example.com     fails if it does not, and confirms first
```

Requiring the old password would buy nothing. Anyone who can run these already has
write access to `data/jobhunt.db` and could replace the hash with three lines of
SQL, and demanding it would break the one case an admin reset exists for — a
password nobody remembers.

The real hazard is a **mistyped email silently locking someone out**, which is why
the two operations are separate rather than one upsert. `user:reset` asks for
confirmation on a TTY and refuses outright when piped unless `--yes` is passed, so
a reset can never happen as a side effect of meaning to create.

Minimum length is 8 characters. Passwords are hashed with scrypt
(`server/utils/password.ts`); the stored format is self-describing
(`scrypt:<salt>:<hash>`) so the algorithm can change without a migration guess.

**There is no in-app password change**, which is a known gap rather than a
decision: today a second user cannot rotate their own credentials without shell
access to the host. An authenticated `PUT /api/password` that _does_ verify the
current password is required before a second account is real. Until then, treat
the CLI as an owner-only tool.

Prefer the interactive prompt over `--password`: a password passed as an argument
lands in shell history and is visible in `ps` while the command runs.

**Every query filters by `user_id`.** No endpoint may return, count, search, or
export rows belonging to anyone but the session's user. This includes the status
count tiles, the FTS search, and the CSV export. A missing `user_id` predicate is a
data-leak bug, not a style issue — treat it as one in review.

## Tech Stack

| Layer           | Choice                      | Notes                                                                                                                                                                                                                                                       |
| --------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | **Nuxt**, latest (4.x)      | SSR + `server/api` routes. Not a bare Vue SPA — a server process is needed for SQLite and sessions.                                                                                                                                                         |
| Language        | **TypeScript**, strict mode |                                                                                                                                                                                                                                                             |
| Auth            | **nuxt-auth-utils**         | Sealed session cookies.                                                                                                                                                                                                                                     |
| Database        | **SQLite**                  | Single file at `data/jobhunt.db`, WAL mode. Not committed.                                                                                                                                                                                                  |
| DB driver       | **better-sqlite3**          | Synchronous, fast, no ORM. `migrations/` is the source of truth.                                                                                                                                                                                        |
| Search          | **SQLite FTS5**             | Descriptions reach ~5.5k characters; `LIKE '%…%'` scans don't hold up.                                                                                                                                                                                      |
| UI              | Hand-rolled CSS             | `app/assets/css/` — tokens, base, components — built from the design artifact. No component library — Nuxt UI was considered and dropped, since the design is a complete system with its own tokens and a zero-radius look a component library would fight. |
| Package manager | **npm**                     |                                                                                                                                                                                                                                                             |
| Tests           | **Vitest**                  | Required for the import, the status rules, and every `server/api` route — including that each route rejects cross-user access.                                                                                                                              |

## Data Model

**Read [docs/schema.sql](schema.sql) rather than reconstructing the model from
this document.** It is the readable snapshot of the current schema, executable
and verified against the seed data.

`migrations/` is what actually runs against a database — numbered SQL files
applied in order, checksummed once applied, each in its own transaction. A
schema change is a *new* migration plus a matching edit to `schema.sql`; editing
an applied migration is refused, since databases that already ran it would never
see the change. `tests/schema-drift.test.ts` fails if the two sources disagree.

Tables:

- **`user`** — id, email, password hash.
- **`status`**, **`next_step`**, **`document_kind`** — lookup tables with `label`,
  `sort_order`, `is_active`, plus `is_terminal` on `status`.
- **`application`** — the working table, `user_id`-scoped, with FKs to the lookups.
- **`status_event`** — append-only history of status changes. See
  [Status history](#status-history).
- **`document`** and **`application_document`** — resumes and cover letters, and
  their many-to-many attachment to applications.

Plus `application_fts` and `document_fts`, FTS5 indexes kept in sync by triggers.

### Status history

`application.status_id` is the _current_ state and carries no timing information.
Every duration metric — time to first response, time to rejection, how long a
stage takes — is computed from `status_event`, which appends a row on every
status change.

**`status_event` is maintained entirely by database triggers.** Application code
never inserts into it, so a transition cannot go unrecorded through forgetfulness.
Updating a non-status column does not create an event, and setting `status_id` to
the value it already holds does not either.

**Seed applications have no history.** The spreadsheet never recorded when a status
changed, so the import clears the events its own inserts generate rather than
inventing timestamps that would poison every duration metric. History begins at
import. Analytics must therefore exclude applications with no `status_event` rows
from duration calculations, and the UI should say "not enough history yet" rather
than showing a misleadingly small sample.

### Documents

Resumes and cover letters are separate kinds in the `document_kind` lookup, stored
in one `document` table. The file itself lives on disk under `data/documents/`;
only its path, MIME type, and size are in the database.

**Search reads `content_text`, not the file.** That column holds the plain-text
body — extracted from the upload where possible, otherwise pasted. A PDF whose text
could not be extracted is still storable, just not findable, and the UI should say
so rather than failing silently.

Attachment is many-to-many via `application_document`: one resume version goes out
with many applications, and an application may carry both a resume and a cover
letter. Deleting an application detaches its documents but never deletes them.

### Vocabularies are fixed and owner-maintained

Status and next-step options live in lookup tables, are **global** (shared by all
users), and are **not editable through the app**. The owner edits `docs/schema.sql`
by hand and re-runs the migration. Three rules follow, and all three matter:

- **The app never writes to `status` or `next_step`.** No UI, no endpoint, no
  script inserts, updates, or deletes a row in either table. They are read-only at
  runtime. Do not build a management screen; it was considered and rejected.
- **Never hardcode a label in application logic.** "Is this application still
  live?" is `status.is_terminal = 0`, not a string comparison. Read-only does not
  mean the values are safe to inline — the owner may relabel them at any time.
- **Never `DELETE` an option that applications reference.** The foreign key will
  refuse. Set `is_active = 0` to retire it — pickers hide it, existing rows keep
  rendering.

`sort_order` drives display order everywhere. It is sparse (10, 20, 30…) so options
can be inserted between existing ones without renumbering.

### Field notes

- **`description`** — free text, either a pasted job description or empty. Long;
  truncate in table views and show in full on the detail view.
- **`job_posting_link`** — the posting URL, split out of `description` during import.
- **`next_step_date_time`** — when the next step happens, date _and_ time. It is
  interpreted against whatever `next_step` says, so it is the screener slot, the
  round-2 slot, or the follow-up reminder depending on context. Drives the calendar
  and reminders. Nullable — most applications never get one.
- **`submitted_to_unemployment`** — boolean, filed with unemployment as proof of search.
  A required weekly filing, so it must be filterable and exportable.
- **`role`** is nullable; four seed rows lack one. New applications should require it.
- **`contact`** — recruiter email. Sparse (9 of 291).

### Dates and times

The app stores **two different kinds of temporal value**, and conflating them is
the most likely source of off-by-one-day bugs here. Check which kind a column is
before touching it.

**Floating calendar dates** — `apply_date`. Format `YYYY-MM-DD`. No time, no
timezone, no conversion, ever. "I applied on June 20th" is true in every timezone.
Never round-trip these through a UTC `Date`: that shifts them across the date line
and silently reports the wrong day.

**Instants** — `next_step_date_time`, plus `created_at` / `updated_at`. Format
`YYYY-MM-DD HH:MM:SS`, **always stored UTC**, rendered in the viewer's local zone.
An interview at 2pm is a specific moment, so it must convert. Storing it as local
wall-clock text would break the moment the app is hosted or the user travels.

So: `apply_date` never converts, `next_step_date_time` always converts. Both are
plain SQLite `TEXT`.

When the owner knows the day of a next step but not the hour, the UI defaults to
**09:00 local**. Some values will therefore be approximate — do not build logic
that treats a stored time as precise.

---

## Seed Data & Import

Three files, in pipeline order:

| File                                  | Role                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `data/jobhunt-project--seed-data.csv` | Raw spreadsheet export. **Source of record — never edit.**                  |
| `scripts/clean-seed-data.py`          | Normalizes raw → canonical. Re-runnable, deterministic.                     |
| `data/seed-applications.csv`          | 291 canonical rows matching the schema. **Generated — never edit by hand.** |

Import must be **idempotent**: running it twice produces one copy of the data, not
two. It is a full local reset, not a merge. All 291 rows are assigned to the seeded
owner account.

The transform already applied, recorded here so it isn't re-derived or re-litigated:

- Dropped 7 trailing rows that had no company, role, date, or status.
- Moved bare URLs out of `description` (245 rows) and `notes` (30) into
  `job_posting_link` — 275 of 291 rows have one. The 24 rows holding real prose
  kept it; only 2 rows retain genuine `notes` text.
- Converted `MM/DD/YYYY` → ISO, and `TRUE`/`FALSE` → 1/0.
- Mapped legacy status strings to the current vocabulary, fixing the source typo
  "Waiting For Inteview" → `Interview scheduled` and splitting `Interviewed (1)`/`(2)`
  into their own values.
- Forced `next_step` to `None` where the status is terminal.
- Left `next_step_date_time` empty on all rows — the spreadsheet never captured it.
- Cleared the `status_event` rows the inserts generated, since the source has no
  transition dates. Seeded applications start with no history.

**Duplicates are intentional.** Nine company+role pairs repeat, with apply dates
months apart One example appears four times: Jan 30, Feb 19, Apr 22, Jul 5).
These are genuine re-applications. Do not add deduplication.

---

## Features

### v1 — replaces the spreadsheet

- **Application table** — sortable columns, truncated description, link out to the posting.
- **Full-text search** across company, role, description, notes via FTS5.
- **Filters**, combinable: status, next step, date range on apply date, and
  `submitted_to_unemployment`. Filter state lives in the URL query string so views are
  bookmarkable and survive reload.
- **Create / edit / delete** an application, with status and next step as dropdowns
  fed from the lookup tables.
- **Status counts** — one tile per active status. Zero-count statuses still render,
  so the empty parts of the pipeline are visible.
- **CSV export** of the current filtered view, not the whole table.
- **Login / logout.**

### v2

- **Calendar view** over `next_step_date_time`, showing what is coming up.
- **Reminders** for upcoming next steps. In-app only — a badge and a dashboard
  panel. No email, no push, no OS notification.
- **Add to Google Calendar** — a link on any application with a
  `next_step_date_time` that opens Google Calendar's event composer prefilled with
  the company, role, next-step label, and time.

  This is a **plain URL, not an integration**: `calendar.google.com/calendar/render`
  with `action=TEMPLATE` and query parameters. No OAuth, no client registration, no
  stored tokens, no background sync, and nothing to break when Google rotates an
  API. The user confirms the event in Google's own UI. Offer a downloadable `.ics`
  alongside it for any other calendar app.

- **Document storage** — upload and manage resumes and cover letters, attach them
  to applications, and search their text. See [Documents](#documents).
- **PDF export**, for sharing with a mentor or career advisor.

### v3 — analytics

All of these read from `status_event` and are meaningless until it has accumulated
data, so they come last on purpose.

- **Funnel conversion** — how many applications reached each stage, and the
  drop-off between stages. The stage counts work off current status and are
  available today; the _rates_ are the new part.
- **Response-time stats** — median and distribution of time from `apply_date` to
  the first status change away from "Applied".
- **Time to rejection** and **time to offer**, as separate distributions.
- **Stage durations** — how long applications sit in each non-terminal status.
- **Currently stalled** — open applications whose last `status_event` is older than
  some threshold. Likely the most immediately useful of the set.

Every one of these must exclude applications with no history and label its sample
size, so a metric computed from four data points is never presented as a trend.

---

## Local Operation

- Runs in WSL, served at **`http://localhost:3000`**.
- Database at `data/jobhunt.db`. Gitignored, along with `.env`, `*.db-wal`,
  `*.db-shm`, and `data/documents/` — uploaded resumes and cover letters never
  reach the repo.
- Session secret comes from `.env`; the app must refuse to start without one rather
  than falling back to a baked-in default.
- **Started by a systemd user service** running the production build, so it survives
  terminal close and comes up with the WSL instance. Setup steps live in `README.md`.
- Human setup instructions belong in `README.md`, not here.

---

## Open Questions

Genuinely undecided. Anything resolved here moves up into the body of this document.

_(None currently open. Prior questions on account creation, vocabulary ownership,
startup mechanism, and next-step times were all resolved into the sections above.)_
