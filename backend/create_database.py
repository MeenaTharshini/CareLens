
import sqlite3
from pathlib import Path

# Locate files relative to this Python script
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

SQL_FILE = DATA_DIR / "hospital_sample.sql"
DB_FILE = DATA_DIR / "hospital.db"


def create_database():
    if not SQL_FILE.exists():
        print(f"ERROR: SQL file not found: {SQL_FILE}")
        return

    if DB_FILE.exists():
        print(f"Database already exists: {DB_FILE}")
        print("Rename or remove the existing database before recreating it.")
        return

    connection = sqlite3.connect(DB_FILE)

    try:
        connection.execute("PRAGMA foreign_keys = ON")

        sql_script = SQL_FILE.read_text(encoding="utf-8")
        connection.executescript(sql_script)

        tables = connection.execute("""
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        """).fetchall()

        print("\nDatabase created successfully!")
        print(f"Location: {DB_FILE}")
        print(f"\nTotal tables: {len(tables)}")
        print("\nTable record counts:")

        for (table_name,) in tables:
            count = connection.execute(
                f'SELECT COUNT(*) FROM "{table_name}"'
            ).fetchone()[0]

            print(f"  {table_name}: {count} records")

        violations = connection.execute(
            "PRAGMA foreign_key_check"
        ).fetchall()

        if violations:
            print(f"\nWARNING: {len(violations)} foreign-key violations found.")
            print(violations[:10])
        else:
            print("\nForeign-key check passed!")

    except Exception as error:
        connection.close()
        if DB_FILE.exists():
            DB_FILE.unlink()
        print(f"Database creation failed: {error}")
        return

    connection.close()


if __name__ == "__main__":
    create_database()
