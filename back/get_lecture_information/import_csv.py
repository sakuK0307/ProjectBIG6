import csv
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "lectures.db"
CSV_PATH = BASE_DIR / "lectures.csv"

def main():
    # CSVをマスターとしてDBを毎回作り直す方式。
    # CSVから削除した行もDBから消えるため、意図しない古いデータが残らない。
    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript((BASE_DIR / "schema.sql").read_text(encoding="utf-8"))

        with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            columns = [
                "id", "course_code", "name", "teacher", "room",
                "grade", "class_group", "semester", "day", "period",
                "description"
            ]
            rows = [tuple(row[c] for c in columns) for row in reader]

        placeholders = ", ".join("?" for _ in columns)
        conn.executemany(
            f"INSERT INTO lectures ({', '.join(columns)}) "
            f"VALUES ({placeholders})",
            rows
        )
        conn.commit()
        print(f"CSVをDBに取り込みました: {DB_PATH}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main()
