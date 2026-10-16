
import sqlite3
from pathlib import Path

db_path = Path(__file__).parent / "data" / "hospital.db"

with sqlite3.connect(db_path) as connection:
    print("\n=== APPOINTMENT STATUS VALUES ===")
    rows = connection.execute("""
        SELECT status, COUNT(*)
        FROM appointments
        GROUP BY status
        ORDER BY COUNT(*) DESC
    """).fetchall()

    for status, count in rows:
        print(f"{status!r}: {count}")

    print("\n=== STATUS COUNTS BY YEAR ===")
    rows = connection.execute("""
        SELECT
            strftime('%Y', appointment_date) AS year,
            status,
            COUNT(*)
        FROM appointments
        GROUP BY year, status
        ORDER BY year, status
    """).fetchall()

    for year, status, count in rows:
        print(f"Year={year}, Status={status!r}, Count={count}")
