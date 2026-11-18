CREATE TABLE IF NOT EXISTS lectures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_code TEXT NOT NULL,
    name TEXT NOT NULL,
    teacher TEXT,
    room TEXT,
    grade INTEGER NOT NULL CHECK(grade >= 1),
    class_group TEXT NOT NULL,
    semester TEXT NOT NULL CHECK(semester IN ('前期', '後期')),
    day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 5),
    period INTEGER NOT NULL CHECK(period >= 1),
    description TEXT
);

CREATE INDEX IF NOT EXISTS idx_lectures_timetable
ON lectures(grade, class_group, semester, day, period);
