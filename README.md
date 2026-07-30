# Job Hunt

A personal job-application tracker. Nuxt 4 + TypeScript + SQLite, built to run
locally in WSL.

Tracks applications through a fixed status pipeline, records what happens next
and when, keeps unemployment proof-of-search filings straight, and exports the
current filtered view to CSV.

- **Requirements** — [docs/PRD.md](docs/PRD.md)
- **Data model** — [docs/schema.sql](docs/schema.sql) (canonical and executable)

## Prerequisites

- Node 22+ (developed on 26.5)
- Python 3 — only for the seed-data transform
- npm

## Setup

```bash
npm install
cp .env.example .env
```

Generate a session secret and put it in `.env` as `NUXT_SESSION_PASSWORD`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The app refuses to start without one — there is no baked-in fallback.

Create the database and an account:

```bash
npm run db:migrate
npm run user:create you@example.com
```

There is no signup page; accounts are created from the CLI by design.

```bash
npm run dev
```

Then open http://127.0.0.1:3000.

## Seed data

**No application data ships with this repo.** The seed files hold real recruiter
email addresses and a personal application history, so they are gitignored. A
fresh clone starts with an empty database — that is a working state, and you can
add applications through the UI.

To import from a spreadsheet, export it to
`data/jobhunt-project--seed-data.csv` with these columns:

```
Company, Role, Description, Contact, Apply Date, Status, Next Steps, Notes, Submitted to UI
```

Then:

```bash
npm run seed:clean                 # normalize it to data/seed-applications.csv
npm run db:seed you@example.com    # load it, replacing that account's rows
```

`scripts/clean-seed-data.py` maps legacy status strings onto the current
vocabulary, splits posting URLs out of the description, and converts dates to
ISO. It fails loudly on a status it does not recognize — add it to `STATUS_MAP`
there. The import is idempotent: running it twice leaves one copy, not two.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Dev server on 127.0.0.1:3000 |
| `npm run build` | Production build into `.output/` |
| `npm test` | Vitest |
| `npm run db:migrate` | Apply `docs/schema.sql` (`-- --force` drops and recreates) |
| `npm run db:seed <email>` | Load `data/seed-applications.csv` for that account |
| `npm run user:create <email>` | Create an account; refuses if it already exists |
| `npm run user:reset <email>` | Reset a password; confirms first |
| `npm run seed:clean` | Regenerate the canonical seed CSV from the raw export |

Positional arguments work directly; flags need npm's separator:
`npm run user:create -- you@example.com --password secret`.

## Running on startup (WSL + systemd)

Confirm systemd is running as PID 1:

```bash
ps -p 1 -o comm=          # should print: systemd
```

If it does not, add this to `/etc/wsl.conf`, then run `wsl --shutdown` from
PowerShell and reopen the shell:

```ini
[boot]
systemd=true
```

Enable lingering so the service runs without an open login session. This is the
step that makes "starts on boot" actually true:

```bash
sudo loginctl enable-linger "$USER"
```

Build once (`npm run build`), then create
`~/.config/systemd/user/jobhunt.service`:

```ini
[Unit]
Description=Job Hunting Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/jamie/dev/jobhunt
ExecStart=/home/jamie/.nvm/versions/node/v26.5.0/bin/node .output/server/index.mjs
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
EnvironmentFile=/home/jamie/dev/jobhunt/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now jobhunt
systemctl --user status jobhunt
journalctl --user -u jobhunt -f     # logs
```

Two caveats:

- **The Node path is pinned.** systemd does not source `.bashrc`, so `nvm` is
  not available to it and `ExecStart` must be an absolute path. It will break on
  a Node upgrade — either update the unit, or symlink `~/.local/bin/node` to the
  current version and point the unit at that.
- **It serves the production build**, so `npm run build` must have run at least
  once, and again after any change you want to go live.

`HOST=127.0.0.1` keeps it on loopback. Authentication exists, but nothing here
is hardened for exposure to a network.

## Privacy

This repo is public and deliberately contains no application data. Keep it that
way — everything under `data/` is gitignored. Before committing, check that no
export, database file, or `.env` has slipped in:

```bash
git status --short
git diff --cached --name-only
```
