# Job Hunt

A personal job-application tracker. Nuxt 4 + TypeScript + SQLite, built to run
locally in WSL.

Tracks applications through a fixed status pipeline and records what happens next
and when. Full-text search and combinable filters over the whole set, sortable
columns, and CSV export of the current filtered view. A month calendar of
upcoming next steps, with one-way handoff to Google Calendar or an `.ics` file.
Résumés and cover letters upload once and attach to as many applications as you
like, with their text extracted so it is searchable. Unemployment
proof-of-search filings stay filterable throughout.

- **Requirements** — [docs/PRD.md](docs/PRD.md)
- **Data model** — [docs/schema.sql](docs/schema.sql) (readable snapshot)
- **Schema changes** — [migrations/](migrations/) (numbered, applied in order)

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
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:status` | List applied / pending migrations |
| `npm run db:reset` | **Destructive** — drop everything and re-apply |
| `npm run db:seed <email>` | Load `data/seed-applications.csv` for that account |
| `npm run user:create <email>` | Create an account; refuses if it already exists |
| `npm run user:reset <email>` | Reset a password; confirms first |
| `npm run seed:clean` | Regenerate the canonical seed CSV from the raw export |

Positional arguments work directly; flags need npm's separator:
`npm run user:create -- you@example.com --password secret`.

## Running at startup (WSL)

Apache already owns port 80 here, so it front-ends the app: Node runs
unprivileged on 3000 and Apache proxies `jobhunt.test` to it. That keeps the URL
clean without giving Node a privileged port.

Two files are in [deploy/](deploy/). Copy them into place:

```bash
npm run build                       # the service serves .output/, so build first

sudo a2enmod proxy proxy_http
sudo cp deploy/jobhunt.conf /etc/apache2/sites-available/
sudo a2ensite jobhunt
sudo systemctl reload apache2

sudo cp deploy/jobhunt.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jobhunt
```

### Make Apache listen on IPv4

In `/etc/apache2/ports.conf`, the top-level `Listen` must be:

```apache
Listen 0.0.0.0:80
```

This is required, not cosmetic. WSL's `wslrelay` mirrors whichever address
family the WSL service binds:

| WSL service binds | Windows reaches it at |
|---|---|
| `::` — what plain `Listen 80` does | `::1` only |
| `0.0.0.0` | `127.0.0.1` |

With the default `Listen 80`, Apache binds the IPv6 wildcard, the relay listens
only on `::1:80`, and a `127.0.0.1` hosts entry gets connection-refused. Pinning
Apache to IPv4 keeps every service on `127.0.0.1`, so hosts entries are uniform.

Apache has **no inline comments** — `#` only starts a comment at the beginning of
a line. `Listen 0.0.0.0:80  # note` is parsed as five arguments and fails with
"Listen requires 1 or 2 arguments".

```bash
sudo apache2ctl configtest
sudo systemctl restart apache2      # restart, not reload — reload will not rebind
ss -ltn | grep ':80'                # expect 0.0.0.0:80, not *:80
```

### Hosts files

Add the same line to **both**:

```
127.0.0.1    jobhunt.test
```

| File | Why both |
|---|---|
| `C:\Windows\System32\drivers\etc\hosts` | So a Windows browser resolves it |
| `/etc/hosts` (WSL) | `/etc/wsl.conf` sets `generateHosts = false`, so WSL does not inherit the Windows file |

Do **not** use the WSL `eth0` address (`172.23.x.x`). It works, but NAT mode
reassigns it on every WSL restart, silently breaking the entry. `127.0.0.1` is
fixed.

Then open **http://jobhunt.test**.

```bash
systemctl status jobhunt
journalctl -u jobhunt -f            # app logs
sudo tail -f /var/log/apache2/jobhunt-error.log
```

### Notes

- **`.test` is deliberate.** `.dev` is a real gTLD on the browser HSTS preload
  list, so `http://` is force-upgraded to HTTPS and fails with no way through;
  `.local` is reserved for mDNS and resolves erratically. `.test` is reserved by
  RFC 6761 for exactly this.
- **Stop `npm run dev` before enabling the service** — both want port 3000.
- **The Node path in the unit is pinned** to a specific nvm version, because
  systemd does not source `.bashrc`. A Node upgrade breaks it until you update
  the path or point it at a stable symlink.
- **Deploy a change** with `npm run build && sudo systemctl restart jobhunt`.

## Privacy

This repo is public and deliberately contains no application data. Keep it that
way — everything under `data/` is gitignored. Before committing, check that no
export, database file, or `.env` has slipped in:

```bash
git status --short
git diff --cached --name-only
```
