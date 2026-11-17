from flask import Flask, jsonify, request
import sqlite3
from pathlib import Path

app = Flask(__name__)
DB_PATH = Path(__file__).with_name("lectures.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.get("/lectures")
def get_lectures():
    grade = request.args.get("grade", type=int)
    class_group = request.args.get("class_group", type=str)
    semester = request.args.get("semester", type=str)
    day = request.args.get("day", type=int)
    period = request.args.get("period", type=int)

    if None in (grade, class_group, semester, day, period):
        return jsonify({
            "error": "grade, class_group, semester, day, period are required"
        }), 400

    if semester not in ("前期", "後期"):
        return jsonify({"error": "semester must be 前期 or 後期"}), 400

    if grade < 1 or not 1 <= day <= 5 or period < 1:
        return jsonify({"error": "invalid grade, day or period"}), 400

    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT id, course_code, name, teacher, room, grade,
                   class_group, semester, day, period, description
            FROM lectures
            WHERE grade = ?
              AND class_group = ?
              AND semester = ?
              AND day = ?
              AND period = ?
            ORDER BY id
        """, (grade, class_group, semester, day, period)).fetchall()

        return jsonify([dict(row) for row in rows])
    finally:
        conn.close()

@app.get("/lectures/<int:lecture_id>")
def get_lecture_by_id(lecture_id):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM lectures WHERE id = ?", (lecture_id,)
        ).fetchone()
        if row is None:
            return jsonify({"error": "Lecture not found"}), 404
        return jsonify(dict(row))
    finally:
        conn.close()

if __name__ == "__main__":
    app.run(debug=True)
