from back.db import db
from back.enums import (
    CourseType,
    Program,
    CreditType,
    Semester,
    Weekday,
    Parity,
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
    """講義"""

    __tablename__ = "lecture"

    subject_id = db.Column(
        db.Integer,
        db.ForeignKey("subject.subject_id"),
        nullable=False,
    )

    year = db.Column(db.Integer, nullable=False)

    semester = db.Column(
        enum_column(Semester, "semester"),
        nullable=False,
    )

    weekday = db.Column(
        enum_column(Weekday, "weekday"),
        nullable=False,
    )

    start_period = db.Column(db.Integer, nullable=False)
    end_period = db.Column(db.Integer, nullable=False)

    parity = db.Column(
        enum_column(Parity, "parity"),
        nullable=False,
        default=Parity.NONE,
    )

    grade = db.Column(db.Integer, nullable=False)

    class_group = db.Column(
        db.String(20),
        nullable=False,
    )

    __table_args__ = (
        db.PrimaryKeyConstraint(
            "subject_id",
            "year",
            "semester",
            "class_group",
            name="pk_lecture",
        ),
        db.CheckConstraint(
            "start_period >= 1 AND end_period >= start_period",
            name="ck_lecture_period",
        ),
        db.CheckConstraint(
            "year >= 2000",
            name="ck_lecture_year",
        ),
        db.Index(
            "ix_lecture_timetable",
            "year",
            "semester",
            "weekday",
            "start_period",
        ),
    )

    subject = db.relationship(
        "Subject",
        back_populates="lectures",
    )
