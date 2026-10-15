
import sqlite3
from datetime import datetime, timezone

from engine import DB_PATH


REVIEW_STATUSES = {
    "Pending Review",
    "In Progress",
    "Resolved",
    "Needs Verification",
}


def _connect():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_review_tables():
    """Create persistent review and audit tables if they do not exist."""
    with _connect() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS care_gap_reviews (
                gap_id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'Pending Review',
                assigned_to TEXT,
                notes TEXT NOT NULL DEFAULT '',
                reviewer TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS care_gap_review_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                gap_id TEXT NOT NULL,
                old_status TEXT,
                new_status TEXT NOT NULL,
                assigned_to TEXT,
                notes TEXT NOT NULL DEFAULT '',
                reviewer TEXT NOT NULL,
                changed_at TEXT NOT NULL
            )
        """)


def get_reviews():
    with _connect() as connection:
        rows = connection.execute("""
            SELECT gap_id, status, assigned_to, notes,
                   reviewer, created_at, updated_at
            FROM care_gap_reviews
        """).fetchall()

    return {row["gap_id"]: dict(row) for row in rows}


def update_review(
    gap_id,
    status,
    assigned_to=None,
    notes="",
    reviewer="CareLens Reviewer",
):
    if status not in REVIEW_STATUSES:
        raise ValueError(
            f"Invalid status. Choose one of: {', '.join(sorted(REVIEW_STATUSES))}"
        )

    now = datetime.now(timezone.utc).isoformat()

    with _connect() as connection:
        current = connection.execute(
            "SELECT * FROM care_gap_reviews WHERE gap_id = ?",
            (gap_id,),
        ).fetchone()

        old_status = (
            current["status"] if current else None
        )

        created_at = (
            current["created_at"] if current else now
        )

        connection.execute("""
            INSERT INTO care_gap_reviews (
                gap_id, status, assigned_to, notes,
                reviewer, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(gap_id) DO UPDATE SET
                status = excluded.status,
                assigned_to = excluded.assigned_to,
                notes = excluded.notes,
                reviewer = excluded.reviewer,
                updated_at = excluded.updated_at
        """, (
            gap_id,
            status,
            assigned_to,
            notes,
            reviewer,
            created_at,
            now,
        ))

        connection.execute("""
            INSERT INTO care_gap_review_history (
                gap_id, old_status, new_status,
                assigned_to, notes, reviewer, changed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            gap_id,
            old_status,
            status,
            assigned_to,
            notes,
            reviewer,
            now,
        ))

        row = connection.execute("""
            SELECT gap_id, status, assigned_to, notes,
                   reviewer, created_at, updated_at
            FROM care_gap_reviews
            WHERE gap_id = ?
        """, (gap_id,)).fetchone()

    return dict(row)


def get_review_history(gap_id):
    with _connect() as connection:
        rows = connection.execute("""
            SELECT id, gap_id, old_status, new_status,
                   assigned_to, notes, reviewer, changed_at
            FROM care_gap_review_history
            WHERE gap_id = ?
            ORDER BY id DESC
        """, (gap_id,)).fetchall()

    return [dict(row) for row in rows]


initialize_review_tables()
