"""データベースの表の定義"""

from back.db import db
from back.enums import (
    CourseType,
    Program,
    CreditType,
    ProgramDesignation,
    Semester,
    Weekday,
    Parity,
    CurriculumArea
)


# ========================================
# Enum型のSQLAlchemy変換
# ========================================

def enum_column(enum_class, name):
    """
    Python EnumをSQLAlchemyのEnumカラムに変換する。
    EnumのvalueをDBに保存する。
    """
    return db.Enum(
        enum_class,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda cls: [
            str(member.value) for member in cls
        ],
    )


# ========================================
# 科目
# ========================================
class Subject(db.Model):
    """科目"""

    __tablename__ = "subject"

    subject_id = db.Column(db.Integer, primary_key=True)
    subject_name = db.Column(db.String(200), nullable=False)

    # Relations
    credits = db.relationship(
        "Credit",
        back_populates="subject",
        cascade="all, delete-orphan",
    )

    lectures = db.relationship(
        "Lecture",
        back_populates="subject",
        cascade="all, delete-orphan",
    )


# ========================================
# 単位
# ========================================
class Credit(db.Model):
    """科目のコース・プログラム別単位情報"""

    __tablename__ = "credit"

    subject_id = db.Column(
        db.Integer,
        db.ForeignKey("subject.subject_id"),
        primary_key=True,
    )

    course = db.Column(
        enum_column(CourseType, "course_type"),
        primary_key=True,
    )

    program = db.Column(
        enum_column(Program, "program"),
        primary_key=True,
    )

    credit_type = db.Column(
        enum_column(CreditType, "credit_type"),
        nullable=False,
    )

    program_designation = db.Column(
        enum_column(ProgramDesignation, "program_designation"),
        nullable=False,
    )

    curriculum_area = db.Column(
        enum_column(CurriculumArea, "curriculum_area"),
        nullable=False,
    )

    is_science_engineering_foundation = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
    )

    credits = db.Column(
        db.Integer,
        nullable=False,
    )

    # Relations
    subject = db.relationship(
        "Subject",
        back_populates="credits",
    )


# ========================================
# 講義
# ========================================
class Lecture(db.Model):
    __tablename__ = "lecture"

    lecture_id = db.Column(db.Integer, primary_key=True)
    subject_id = db.Column(
        db.Integer,
        db.ForeignKey("subject.subject_id"),
        nullable=False,
    )
    year = db.Column(db.Integer, nullable=False)
    semester = db.Column(enum_column(Semester, "semester"), nullable=False)
    grade = db.Column(db.Integer, nullable=False)

    time_slots = db.relationship(
        "LectureTime",
        back_populates="lecture",
        cascade="all, delete-orphan",
    )

    subject = db.relationship(
        "Subject",
        back_populates="lectures",
    )

class LectureTime(db.Model):
    __tablename__ = "lecture_time"

    lecture_id = db.Column(
        db.Integer,
        db.ForeignKey("lecture.lecture_id"),
        primary_key=True,
    )
    weekday = db.Column(
        enum_column(Weekday, "weekday"),
        primary_key=True,
    )
    start_period = db.Column(db.Integer, primary_key=True)
    end_period = db.Column(db.Integer, nullable=False)
    parity = db.Column(
        enum_column(Parity, "parity"),
        primary_key=True,
        default=Parity.NONE,
    )
    class_group = db.Column(db.String(20), primary_key=True)

    lecture = db.relationship("Lecture", back_populates="time_slots")
