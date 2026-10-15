
import sqlite3
from pathlib import Path

DB_FILE = Path(__file__).resolve().parent / "data" / "hospital.db"

connection = sqlite3.connect(DB_FILE)
connection.row_factory = sqlite3.Row

tables = connection.execute("""
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
""").fetchall()

print("CARE LENS DATABASE INSPECTION")
print("=" * 60)

for item in tables:
    table = item["name"]

    columns = connection.execute(
        f'PRAGMA table_info("{table}")'
    ).fetchall()

    count = connection.execute(
        f'SELECT COUNT(*) FROM "{table}"'
    ).fetchone()[0]

    print(f"\nTABLE: {table} ({count} rows)")
    print("Columns:", ", ".join(
        f'{col["name"]} [{col["type"] or "unspecified"}]'
        for col in columns
    ))

    if count > 0:
        sample = connection.execute(
            f'SELECT * FROM "{table}" LIMIT 2'
        ).fetchall()

        for row in sample:
            print(" ", dict(row))

connection.close()
