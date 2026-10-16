
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "hospital.db"

with sqlite3.connect(DB_PATH) as connection:
    for table in ["doctors", "staff", "departments", "appointments"]:
        print(f"\n{'=' * 12} {table.upper()} {'=' * 12}")

        columns = connection.execute(
            f'PRAGMA table_info("{table}")'
        ).fetchall()

        print("COLUMNS:")
        for column in columns:
            print(f"  {column[1]} ({column[2]})")

        foreign_keys = connection.execute(
            f'PRAGMA foreign_key_list("{table}")'
        ).fetchall()

        print("FOREIGN KEYS:")
        if not foreign_keys:
            print("  None declared")

        for fk in foreign_keys:
            print(f"  {fk[3]} -> {fk[2]}.{fk[4]}")

        # Show a few sample rows to identify the actual relationship.
        rows = connection.execute(
            f'SELECT * FROM "{table}" LIMIT 3'
        ).fetchall()

        print("SAMPLE ROWS:")
        for row in rows:
            print(" ", row)
