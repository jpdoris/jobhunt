# Job Hunting Dashboard

Personal job-application tracker replacing a spreadsheet. Nuxt (latest 4.x) +
TypeScript + SQLite, running locally in WSL.

**Read [docs/PRD.md](docs/PRD.md) before proposing features or changing scope.**
**Read [docs/schema.sql](docs/schema.sql) before writing any query.** It is
executable and verified against the seed data — do not reconstruct the data model
from memory or from this file.

## Hard rules

Violating any of these is a bug, not a style preference.

1. **Every application query filters by `user_id`.** The app is multi-user. A
   missing `user_id` predicate leaks another user's data — this includes counts,
   FTS search, exports, and any `WHERE id = ?` lookup, which must also verify
   ownership rather than trusting the id.

2. **`status` and `next_step` are read-only at runtime.** No UI, endpoint, or
   script inserts, updates, or deletes rows in those tables. The owner edits
   `docs/schema.sql` by hand. Do not build a vocabulary-management screen — it was
   proposed and explicitly rejected.

3. **Never hardcode a status or next-step label in logic.** "Still live" is
   `status.is_terminal = 0`, never `status.label != 'Rejected'`. The owner may
   relabel values at any time.

4. **Never `DELETE` a lookup row that applications reference.** The FK will refuse.
   Set `is_active = 0` to retire it; pickers hide it, existing rows still render.

5. **`data/seed-applications.csv` is generated.** Never hand-edit it. Change
   `scripts/clean-seed-data.py` and re-run. `data/jobhunt-project--seed-data.csv`
   is the raw export and is never edited at all.

6. **`apply_date` and `next_step_date_time` are different kinds of value.** See
   below. Getting this wrong produces off-by-one-day bugs that look like timezone
   flakiness.

7. **Never `INSERT INTO status_event` from application code.** Database triggers
   append to it on every status change. Writing to it by hand produces duplicate
   or contradictory history. Just update `application.status_id`.

8. **Schema changes are a new migration, never an edit to an applied one.** Add
   `migrations/NNNN_description.sql` *and* update `docs/schema.sql` to match.
   `db:migrate` checksums applied files and refuses to run if one changed, and
   `tests/schema-drift.test.ts` fails if the two sources disagree.

## Dates vs. instants

| Column                     | Kind                   | Format                | Converts?                        |
| -------------------------- | ---------------------- | --------------------- | -------------------------------- |
| `apply_date`               | Floating calendar date | `YYYY-MM-DD`          | **Never**                        |
| `next_step_date_time`      | UTC instant            | `YYYY-MM-DD HH:MM:SS` | **Always** → viewer's local zone |
| `created_at`, `updated_at` | UTC instant            | `YYYY-MM-DD HH:MM:SS` | Not user-facing                  |

"I applied on June 20th" is true in every timezone — never round-trip `apply_date`
through a UTC `Date`, which shifts it across the date line. An interview at 2pm is a
specific moment and must convert.

When the owner knows the day but not the hour, the UI stores **09:00 local**. Stored
times are therefore sometimes approximate; don't build logic that assumes precision.

## Layout

```
app/assets/css/main.css               ALL styling — tokens, components, layout
app/pages/                            login, dashboard, detail, calendar
app/components/                       AppNav, ApplicationForm, AppIcon
server/api/                           REST endpoints (all user-scoped)
server/database/index.ts              shared better-sqlite3 connection
server/utils/applications.ts          every application query lives here
scripts/                              db-migrate, db-seed, create-user, clean-seed-data
data/jobhunt-project--seed-data.csv   raw spreadsheet export — source of record, never edit
data/seed-applications.csv            291 canonical rows — GENERATED, never edit
data/jobhunt.db                       SQLite database — gitignored
data/documents/                       uploaded resumes and cover letters — gitignored
docs/PRD.md                           requirements, decisions, non-goals
docs/schema.sql                       readable snapshot of the current schema
migrations/                           numbered SQL — what actually runs against a database
```

## Commands

```bash
npm run dev                 # dev server on http://127.0.0.1:3000
npm run build               # production build into .output/
npm test                    # vitest
npm run db:migrate          # apply pending migrations/
npm run db:status           # list applied / pending, change nothing
npm run db:reset            # DESTRUCTIVE: drop everything, re-apply from scratch
npm run db:seed you@example.com    # load the 291 seed rows for that account
npm run user:create you@example.com     # create; refuses if the email exists
npm run user:reset  you@example.com     # reset a password; confirms first
npm run seed:clean          # regenerate data/seed-applications.csv from the raw export
```

Scripts under `scripts/` run via `node --experimental-strip-types`, so their
relative imports need explicit `.ts` extensions — Node's ESM resolver does not
guess them, and directory imports fail outright.

**npm's `--` separator is required for `--flags` but not for positional args.**
Without it npm 12 rejects unknown flags outright (`EUNKNOWNCONFIG`) rather than
passing them through. That is why `user:create` and `user:reset` take the email
positionally — the common path needs no separator.

## Styling

Three global stylesheets, loaded in this order from `nuxt.config.ts` (order
matters — tokens define what the others read):

| File                                            | Holds                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tokens.css](app/assets/css/tokens.css)         | `:root` only. Colour, ink, washes, type scale, spacing, structure, measures.                                                                                  |
| [base.css](app/assets/css/base.css)             | `@font-face`, reset, body, headings, links, `.text-muted`, `.visually-hidden`.                                                                                |
| [components.css](app/assets/css/components.css) | Shared components and layout primitives: `.btn`, `.field`/`.input`/`.radio`, `.card`, `.tag`, `.nav`, `.table`, `.dialog`, `.tooltip`, `.page`, `.page-head`, `.cluster`. |

**Where new CSS goes:** global only if two or more components use it, or it is a
canonical design-system piece. Styling for exactly one component belongs in that
component's `<style scoped>` block — that is where `.auth*`, `.stat-grid`,
`.filter-bar`, `.form-grid*`, and `.detail-*` live. Scoped blocks still use the
tokens; custom properties are global regardless of scoping.

`.dialog*` is the deliberate exception: one user today (ApplicationForm), kept
global as a canonical component since the delete confirm is the obvious second.

**No `style=""` attributes.** Inline styles are the one hard rule here — reach for
a token or a class instead.

Prefer an existing token over a literal. Two pairs look redundant but are not:
`--focus-ring` and `--rule-accent` share a value but not a meaning, and
`--space-3`/`--text-sm` collide at 12px by coincidence on different axes.

The heading font-family/weight pair is set **once**, in base.css, on a grouped
selector (`h1, h2, .btn, .card-title, .dialog-title, .nav-brand`). Component
rules set size only — never repeat the pair.

The look is the "Modernist" direction from the design artifact: **zero border
radius**, 2px structural rules, Archivo 800 headings, one vermillion accent
(`--color-accent: #ec3013`). Archivo is self-hosted from `public/fonts/` in three
`@font-face` blocks split by `unicode-range` — that repetition is deliberate, so
English pages fetch only the ~35 kB Latin subset. Do not merge them.

The design is **light-mode only** — there is no dark palette, and adding one
means defining a second token block, not patching individual rules.

## Conventions

- TypeScript strict mode. `better-sqlite3` with hand-written SQL; no ORM.
- Search goes through the `application_fts` FTS5 table, never `LIKE '%…%'` —
  descriptions run to ~5.5k characters. User input reaches FTS5's query parser,
  so it must be quoted (`ftsQuery` in `server/utils/applications.ts`) or bare
  punctuation is a syntax error.
- Validate request input with `parseOr400`, not `schema.parse` — a raw ZodError
  escapes as a 500 when it should be a 400.
- Filter state lives in the URL query string so views are bookmarkable.
- Vitest for tests. Every `server/api` route needs a test proving it rejects
  cross-user access.
- The app refuses to start without `NUXT_SESSION_PASSWORD` in `.env`; no
  baked-in fallback.
- Password hashing is `hashUserPassword` / `verifyUserPassword` in
  `server/utils/password.ts`. They are deliberately _not_ named `hashPassword` /
  `verifyPassword`, which would shadow nuxt-auth-utils' auto-imported versions.
  Theirs can't be used from the CLI scripts because they depend on Nuxt's
  `#imports` alias.

## Facts that are easy to guess wrong

- **`submitted_to_unemployment`** records that an application was filed with
  unemployment as proof of search — a weekly requirement. Must stay filterable and
  exportable. The raw export calls this column "Submitted to UI", where UI means
  unemployment insurance, not user interface; the schema was renamed to kill that
  ambiguity, and only `scripts/clean-seed-data.py` still touches the old header.
- **Duplicate company + role rows are intentional.** Nine pairs repeat with apply
  dates months apart (One example appears four times: Jan 30, Feb 19, Apr 22, Jul 5).
  These are genuine re-applications. Do not add deduplication.
- **`description` is usually empty.** Only 24 of 291 rows hold real prose; the
  posting URL lives in `job_posting_link` (275 rows). Early drafts of this project
  assumed the reverse.
- **`role` is nullable** — 4 seed rows lack one. New applications should require it.
- **`contact` is sparse** — 9 of 291 rows. Don't build features that assume it.
- **`next_step_date_time` is empty on all 291 seed rows.** The spreadsheet never
  captured it, so the calendar and reminders start empty and fill in going forward.
- **Seeded applications have no `status_event` history**, deliberately — the
  spreadsheet never recorded transition dates, so the import clears the events its
  inserts generate rather than inventing timestamps. Every duration metric must
  exclude applications with no events and label its sample size. Expect analytics
  to be empty or near-empty for a long while; that is correct, not broken.
- Statuses `Offer received` / `Offer declined` / `Offer accepted` currently have
  zero rows. That is real data, not a bug.
- **"Add to Google Calendar" is a URL, not an integration.** It builds a
  `calendar.google.com/calendar/render?action=TEMPLATE&…` link. There is no OAuth,
  no client registration, no stored token, and nothing to sync back. If a change
  seems to need Google credentials, the approach has drifted — stop and ask.
- **Document search reads `document.content_text`, never the file on disk.** A PDF
  whose text could not be extracted is storable but unfindable; surface that to the
  user rather than failing quietly.

## Scope

The PRD's Non-Goals section is binding. Several entries are _partial_ — the
neighbouring feature is in scope, so read the boundary rather than the headline:

| In scope                              | Still out of scope                                       |
| ------------------------------------- | -------------------------------------------------------- |
| Storing resumes and cover letters     | Generating or tailoring their content                    |
| One-way "add to Google Calendar" link | OAuth, token storage, two-way sync, reading the calendar |
| Analytics from `status_event`         | Any inference of status from email                       |
| Pasting a job description by hand     | Fetching `job_posting_link` to fill `description`        |

Also out entirely: sharing or collaboration between users, native mobile app, PWA.

If a request seems to need one of these, say so and ask rather than building it.
