"""CSVデータをFlask-SQLAlchemyのデータベースへ登録します。

実行例:
    py register_db_from_csv.py
"""

from __future__ import annotations

import csv
import sys
from enum import IntEnum
from pathlib import Path

from flask import Flask


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def read_rows(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def as_enum(enum_class, value: str):
    try:
        if issubclass(enum_class, IntEnum):
            return enum_class(int(value.strip()))
        return enum_class(value)
    except ValueError as error:
        raise ValueError(f"Invalid {enum_class.__name__} value: {value!r}") from error


def main() -> None:
    app = Flask(
        "project_big6_csv_import",
        instance_path=str(PROJECT_ROOT / "instance"),
    )
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///myclassplan.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    from back.db import db, init_db
    from back.models.model import Credit, Lecture, LectureTime, Subject
    from back.enums import (
        CreditType,
        CourseType,
        CurriculumArea,
        Parity,
        Program,
        ProgramDesignation,
        Semester,
        Weekday,
    )

    init_db(app)

    with app.app_context():
        try:
            for row in read_rows(SCRIPT_DIR / "subjects.csv"):
                subject_id = int(row["subject_id"])
                subject = db.session.get(Subject, subject_id)
                if subject is None:
                    subject = Subject(subject_id=subject_id)
                    db.session.add(subject)
                subject.subject_name = row["subject_name"]

            for row in read_rows(SCRIPT_DIR / "credits.csv"):
                subject_id = int(row["subject_id"])
                course = as_enum(CourseType, row["course"])
                program = as_enum(Program, row["program"])
                credit = db.session.get(Credit, (subject_id, course, program))
                if credit is None:
                    credit = Credit(
                        subject_id=subject_id, course=course, program=program
                    )
                    db.session.add(credit)
                credit.credit_type = as_enum(CreditType, row["credit_type"])
                credit.program_designation = as_enum(
                    ProgramDesignation, row["program_designation"]
                )
                credit.credits = int(row["credits"])
                credit.curriculum_area = as_enum(
                    CurriculumArea, row["curriculum_area"]
                )
                credit.is_science_engineering_foundation = (
                    row["is_science_engineering_foundation"].strip().lower() == "true"
                )

            for row in read_rows(SCRIPT_DIR / "lectures.csv"):
                if not row["lecture_id"]:
                    continue
                lecture_id = int(row["lecture_id"])
                lecture = db.session.get(Lecture, lecture_id)
                if lecture is None:
                    lecture = Lecture(lecture_id=lecture_id)
                    db.session.add(lecture)
                lecture.subject_id = int(row["subject_id"])
                lecture.year = int(row["year"])
                lecture.semester = as_enum(Semester, row["semester"])
                lecture.grade = int(row["grade"])

            lecture_times_path = SCRIPT_DIR / "lecture_times.csv"
            if lecture_times_path.exists():
                for row in read_rows(lecture_times_path):
                    if not row["lecture_id"]:
                        continue
                    key = (
                        int(row["lecture_id"]),
                        as_enum(Weekday, row["weekday"]),
                        int(row["start_period"]),
                        as_enum(Parity, row["parity"]),
                        row["class_group"],
                    )
                    lecture_time = db.session.get(LectureTime, key)
                    if lecture_time is None:
                        lecture_time = LectureTime(
                            lecture_id=key[0],
                            weekday=key[1],
                            start_period=key[2],
                            parity=key[3],
                            class_group=key[4],
                        )
                        db.session.add(lecture_time)
                    lecture_time.end_period = int(row["end_period"])

            db.session.commit()
            print(f"CSVをDBに登録しました: {app.instance_path}")
        except Exception:
            db.session.rollback()
            raise


if __name__ == "__main__":
    main()
