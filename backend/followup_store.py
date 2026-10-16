import sqlite3
from pathlib import Path
from datetime import datetime, timezone, date

DB_PATH = Path(__file__).resolve().parent / "data" / "followups.db"

STATUSES = {"Pending", "In Progress", "Alert Sent", "Completed", "Cancelled"}
CLOSED_STATUSES = {"Completed", "Cancelled"}
_UNSET = object()


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_followup_db():
    with connect() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS follow_ups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id TEXT NOT NULL,
                title TEXT NOT NULL,
                reason TEXT NOT NULL,
                due_date TEXT NOT NULL,
                priority TEXT NOT NULL DEFAULT 'Medium',
                assigned_to TEXT,
                status TEXT NOT NULL DEFAULT 'Pending',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                auto_generated INTEGER NOT NULL DEFAULT 0
            )
        """)
        # Backward-compatible migration for databases created before auto follow-ups.
        columns = {row[1] for row in connection.execute("PRAGMA table_info(follow_ups)").fetchall()}
        if "auto_generated" not in columns:
            connection.execute("ALTER TABLE follow_ups ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0")


def list_followups(include_closed=False):
    init_followup_db()
    query = "SELECT * FROM follow_ups"
    if not include_closed:
        query += " WHERE status NOT IN ('Completed', 'Cancelled')"
    query += " ORDER BY due_date ASC, id DESC"
    with connect() as connection:
        return [dict(row) for row in connection.execute(query).fetchall()]


def get_followup(followup_id):
    init_followup_db()
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM follow_ups WHERE id = ?", (followup_id,)
        ).fetchone()
        return dict(row) if row else None


def create_followup(patient_id, title, reason, due_date, priority, assigned_to, auto_generated=False):
    init_followup_db()
    # Store dates in ISO YYYY-MM-DD format for consistent overdue calculations.
    due_date = date.fromisoformat(str(due_date)[:10]).isoformat()
    now = datetime.now(timezone.utc).isoformat()
    with connect() as connection:
        cursor = connection.execute("""
            INSERT INTO follow_ups (
                patient_id, title, reason, due_date, priority,
                assigned_to, status, notes, created_at, updated_at, auto_generated
            ) VALUES (?, ?, ?, ?, ?, ?, 'Pending', '', ?, ?, ?)
        """, (
            str(patient_id), title, reason, due_date, priority,
            assigned_to, now, now, 1 if auto_generated else 0,
        ))
        row = connection.execute(
            "SELECT * FROM follow_ups WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return dict(row)


def update_followup(
    followup_id,
    status=_UNSET,
    assigned_to=_UNSET,
    notes=_UNSET,
    due_date=_UNSET,
):
    """Update only supplied fields. Pass due_date as YYYY-MM-DD to reschedule."""
    init_followup_db()
    current = get_followup(followup_id)
    if current is None:
        return None

    updates = {}
    if status is not _UNSET:
        if status not in STATUSES:
            raise ValueError("Invalid follow-up status.")
        updates["status"] = status
    if due_date is not _UNSET:
        if due_date is None:
            raise ValueError("due_date cannot be empty.")
        try:
            updates["due_date"] = date.fromisoformat(str(due_date)[:10]).isoformat()
        except (TypeError, ValueError):
            raise ValueError("due_date must be a valid date in YYYY-MM-DD format.")
    if assigned_to is not _UNSET:
        updates["assigned_to"] = assigned_to
    if notes is not _UNSET:
        updates["notes"] = "" if notes is None else notes

    if not updates:
        return current

    now = datetime.now(timezone.utc).isoformat()
    updates["updated_at"] = now
    if updates.get("status") == "Completed":
        updates["completed_at"] = now
    elif updates.get("status") in {"Pending", "In Progress", "Alert Sent"}:
        updates["completed_at"] = None

    assignments = ", ".join(f"{column} = ?" for column in updates)
    values = list(updates.values()) + [followup_id]
    with connect() as connection:
        connection.execute(
            f"UPDATE follow_ups SET {assignments} WHERE id = ?", values
        )
    return get_followup(followup_id)


init_followup_db()
