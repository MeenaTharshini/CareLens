import sqlite3
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path(__file__).resolve().parent / "data" / "followups.db"

STATUSES = {"Pending", "In Progress", "Alert Sent", "Completed", "Cancelled"}


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
                completed_at TEXT
            )
        """)


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
            "SELECT * FROM follow_ups WHERE id = ?",
            (followup_id,),
        ).fetchone()
        return dict(row) if row else None


def create_followup(
    patient_id, title, reason, due_date, priority, assigned_to
):
    init_followup_db()
    now = datetime.now(timezone.utc).isoformat()

    with connect() as connection:
        cursor = connection.execute("""
            INSERT INTO follow_ups (
                patient_id, title, reason, due_date, priority,
                assigned_to, status, notes, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'Pending', '', ?, ?)
        """, (
            str(patient_id), title, reason, due_date, priority,
            assigned_to, now, now,
        ))

        row = connection.execute(
            "SELECT * FROM follow_ups WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()

        return dict(row)


def update_followup(followup_id, status, assigned_to=None, notes=""):
    init_followup_db()

    if status not in STATUSES:
        raise ValueError("Invalid follow-up status.")

    now = datetime.now(timezone.utc).isoformat()
    completed_at = now if status == "Completed" else None

    with connect() as connection:
        cursor = connection.execute("""
            UPDATE follow_ups
            SET status = ?,
                assigned_to = ?,
                notes = ?,
                updated_at = ?,
                completed_at = CASE
                    WHEN ? = 'Completed' THEN ?
                    WHEN ? IN ('Pending', 'In Progress', 'Alert Sent')
                        THEN NULL
                    ELSE completed_at
                END
            WHERE id = ?
        """, (
            status, assigned_to, notes, now,
            status, completed_at, status, followup_id,
        ))

        if cursor.rowcount == 0:
            return None

        row = connection.execute(
            "SELECT * FROM follow_ups WHERE id = ?",
            (followup_id,),
        ).fetchone()

        return dict(row)


init_followup_db()
