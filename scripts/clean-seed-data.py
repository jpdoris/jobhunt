#!/usr/bin/env python3
"""Normalize the exported spreadsheet into the canonical seed CSV.

Reads  data/jobhunt-project--seed-data.csv  (raw export, do not edit)
Writes data/seed-applications.csv           (canonical, matches docs/schema.sql)

Re-runnable: same input always produces the same output.
"""

import csv
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "jobhunt-project--seed-data.csv"
DST = ROOT / "data" / "seed-applications.csv"

URL = re.compile(r"https?://\S+")

# Legacy spreadsheet value -> canonical status label.
STATUS_MAP = {
    "Applied": "Applied",
    "Contacted Recruiter": "Contacted recruiter",
    "Waiting For Inteview": "Interview scheduled",  # typo in source
    "Interviewed (1)": "Interviewed (round 1)",
    "Interviewed (2)": "Interviewed (round 2)",
    "Rejected": "Rejected",
    "N/A": "Expired / Not pursued",
}

NEXT_STEP_MAP = {
    "Awaiting Response": "Awaiting response",
    "Follow Up": "Follow up",
    "Interview Round 2": "Interview round 2",
    "Completed": "None",
    "": "None",
}

# Statuses after which no further action is expected.
TERMINAL = {
    "Offer declined",
    "Offer accepted",
    "Rejected",
    "Expired / Not pursued",
}

# Where an open application was marked finished with no decision recorded. In
# practice that meant the posting was pulled.
CLOSED_WITHOUT_DECISION = "Expired / Not pursued"

FIELDS = [
    "company",
    "role",
    "description",
    "job_posting_link",
    "contact",
    "apply_date",
    "status",
    "next_step",
    "next_step_date_time",
    "notes",
    "submitted_to_unemployment",
]


def is_bare_url(value):
    return bool(URL.fullmatch(value.strip()))


def to_iso(value):
    value = value.strip()
    if not value:
        return ""
    return datetime.strptime(value, "%m/%d/%Y").strftime("%Y-%m-%d")


def main():
    rows = list(csv.DictReader(SRC.open(encoding="utf-8-sig")))
    out = []
    stats = Counter()
    notes_ = []

    for line, row in enumerate(rows, start=2):
        row = {k: (v or "").strip() for k, v in row.items()}

        # Trailing spreadsheet filler: no company, role, date, or status.
        if not any(row[c] for c in ("Company", "Role", "Apply Date", "Status")):
            stats["dropped_blank"] += 1
            continue

        # Description holds either prose or a bare posting URL; Notes sometimes
        # holds the URL instead. Description wins where both are present.
        description, link, notes = row["Description"], "", row["Notes"]
        if is_bare_url(description):
            link, description = description, ""
            stats["link_from_description"] += 1
        if is_bare_url(notes):
            if not link:
                link = notes
                stats["link_from_notes"] += 1
            elif notes.strip() != link.strip():
                notes_.append(f"row {line}: conflicting links, kept Description's")
                stats["link_conflict"] += 1
            notes = ""

        status = STATUS_MAP[row["Status"]]
        next_step = NEXT_STEP_MAP[row["Next Steps"]]

        # "Completed" means the process ended. Against a terminal status that
        # agrees, and only the next step needs clearing. Against an open status
        # it contradicts: the application finished with no decision recorded.
        if row["Next Steps"] == "Completed" and status not in TERMINAL:
            notes_.append(
                f"row {line}: open status {row['Status']!r} marked 'Completed'; "
                f"recorded as {CLOSED_WITHOUT_DECISION!r}"
            )
            status = CLOSED_WITHOUT_DECISION
            stats["closed_without_decision"] += 1
        elif status in TERMINAL and next_step != "None":
            notes_.append(
                f"row {line}: terminal status {row['Status']!r} with next step "
                f"{row['Next Steps']!r}; next step set to None"
            )
            next_step = "None"
            stats["terminal_next_step_reset"] += 1

        if not row["Role"]:
            stats["missing_role"] += 1

        out.append(
            {
                "company": row["Company"],
                "role": row["Role"],
                "description": description,
                "job_posting_link": link,
                "contact": row["Contact"],
                "apply_date": to_iso(row["Apply Date"]),
                "status": status,
                "next_step": next_step,
                "next_step_date_time": "",  # no source data; filled in by the app
                "notes": notes,
                # Source header is "Submitted to UI" — UI here means unemployment
                # insurance, not user interface.
                "submitted_to_unemployment": "1" if row["Submitted to UI"] == "TRUE" else "0",
            }
        )

    with DST.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(out)

    print(f"{len(rows)} raw rows -> {len(out)} clean rows  ({DST.relative_to(ROOT)})")
    for key, count in sorted(stats.items()):
        print(f"  {key:28} {count}")
    if notes_:
        print("\nrules applied to ambiguous source rows:")
        for note in notes_:
            print(f"  {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
