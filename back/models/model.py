from back.db import db


class Subject(db.Model):
    __tablename__ = "subject"

    subject_id = db.Column(db.Integer, primary_key=True)
    credits = db.Column(db.Integer, nullable=False)
    general_course_category = db.Column(db.String(30), nullable=False)
    advanced_course_category = db.Column(db.String(30), nullable=False)
    de_program = db.Column(db.Integer, nullable=False)
    ns_program = db.Column(db.Integer, nullable=False)
    hm_program = db.Column(db.Integer, nullable=False)
    pc_program = db.Column(db.Integer, nullable=False)

    lectures = db.relationship("Lecture", back_populates="subject")


class Lecture(db.Model):
    __tablename__ = "lecture"

    lecture_id = db.Column(db.Integer, primary_key=True)
    subject_id = db.Column(
        db.Integer,
        db.ForeignKey("subject.subject_id"),
        nullable=False,
    )
    lecture_information = db.Column(db.Text, nullable=False)
    weekday = db.Column(db.Integer, nullable=False)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    semester = db.Column(db.String(10), nullable=False)
    grade = db.Column(db.Integer, nullable=False)
    class_group = db.Column(db.String(20), nullable=False)
    parity_category = db.Column(db.String(10), nullable=False)

    subject = db.relationship("Subject", back_populates="lectures")
