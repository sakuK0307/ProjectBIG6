
const timetable = document.getElementById("timetable");

const days = { mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土" };
const periods = [1, 2, 3, 4, 5, 6];

// API連携時は、このオブジェクトを講義一覧のJSONレスポンスに差し替える。
const courseData = {
  "courses": [
    {
      "id": "course-001",
      "name": "講義A",
      "credits": 2,
      "schedules": [{ "day": "mon", "period": 1 }]
    },
    {
      "id": "course-002",
      "name": "講義B",
      "credits": 2,
      "schedules": [{ "day": "mon", "period": 1 }]
    },
    {
      "id": "course-003",
      "name": "講義C",
      "credits": 2,
      "schedules": [{ "day": "wed", "period": 2 }]
    },
    {
      "id": "course-004",
      "name": "講義D",
      "credits": 2,
      "schedules": [{ "day": "mon", "period": 3 }, { "day": "mon", "period": 4 }]
    }
  ]
};

const slotKey = ({ day, period }) => `${day}:${period}`;
const slotLabel = ({ day, period }) => `${days[day]}曜${period}限`;

if (timetable) {
  const picker = document.getElementById("course-picker");
  const pickerTitle = document.getElementById("course-picker-title");
  const options = document.getElementById("course-options");
  const removeButton = document.getElementById("remove-course");
  const closeButton = document.getElementById("close-course-picker");
  const bottomPanel = window.matchMedia("(max-width: 768px), (pointer: coarse)");
  const courses = new Map(courseData.courses.map((course) => [course.id, course]));
  const candidatesBySlot = new Map();
  // 登録済みの枠には講義IDだけを保存する。
  const draftBySlot = new Map();
  const cells = new Map();
  let selectedCell;

  for (const course of courses.values()) {
    for (const schedule of course.schedules) {
      const key = slotKey(schedule);
      if (!candidatesBySlot.has(key)) candidatesBySlot.set(key, []);
      candidatesBySlot.get(key).push(course);
    }
  }

  for (const day of ["時限", ...Object.values(days)]) {
    const cell = document.createElement("div");
    cell.className = "cell header";
    cell.textContent = day;
    timetable.appendChild(cell);
  }

  for (const period of periods) {
    const periodCell = document.createElement("div");
    periodCell.className = "cell header";
    periodCell.textContent = `${period}限`;
    timetable.appendChild(periodCell);

    for (const day of Object.keys(days)) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell empty";
      cell.dataset.day = days[day];
      cell.dataset.dayCode = day;
      cell.dataset.period = String(period);
      cell.setAttribute("aria-label", slotLabel({ day, period }));
      cell.setAttribute("aria-controls", picker.id);
      cell.setAttribute("aria-expanded", "false");
      cells.set(slotKey({ day, period }), cell);

      timetable.appendChild(cell);
    }
  }

  function updateCourseSlots(course, courseId) {
    for (const schedule of course.schedules) {
      const key = slotKey(schedule);
      const cell = cells.get(key);
      const registered = courseId !== undefined;
      if (registered) {
        draftBySlot.set(key, courseId);
      } else {
        draftBySlot.delete(key);
      }
      cell.textContent = registered ? course.name : "";
      cell.classList.toggle("registered", registered);
      cell.classList.toggle("empty", !registered);
      const label = slotLabel(schedule);
      cell.setAttribute("aria-label", registered ? `${label} ${course.name}` : label);
    }
  }

  function conflictsWithDraft(course, currentId) {
    // 変更元の講義は登録時に全枠から外すため、重複判定から除く。
    return course.schedules.some((schedule) => {
      const registeredId = draftBySlot.get(slotKey(schedule));
      return registeredId !== undefined && registeredId !== currentId;
    });
  }

  function selectedSlot() {
    return { day: selectedCell.dataset.dayCode, period: selectedCell.dataset.period };
  }

  function positionPicker() {
    if (!selectedCell || bottomPanel.matches) return;

    const cell = selectedCell.getBoundingClientRect();
    const gap = 8;
    const right = document.documentElement.clientWidth - picker.offsetWidth - gap;
    const bottom = document.documentElement.clientHeight - picker.offsetHeight - gap;
    const side = cell.right + gap <= right ? cell.right + gap : cell.left - picker.offsetWidth - gap;
    // セルの右に収まらないときは左を使い、画面内に収める。
    picker.style.setProperty("--picker-left", `${Math.max(gap, Math.min(side, right))}px`);
    picker.style.setProperty("--picker-top", `${Math.max(gap, Math.min(cell.top, bottom))}px`);
  }

  function closePicker(restoreFocus) {
    const cell = selectedCell;
    picker.hidden = true;
    cell.classList.remove("selected");
    cell.setAttribute("aria-expanded", "false");
    selectedCell = undefined;
    if (restoreFocus) cell.focus({ preventScroll: true });
  }

  timetable.addEventListener("click", (event) => {
    const cell = event.target.closest("button.cell");
    if (!cell) return;

    if (selectedCell) closePicker(false);
    selectedCell = cell;
    cell.classList.add("selected");
    cell.setAttribute("aria-expanded", "true");
    const slot = selectedSlot();
    const key = slotKey(slot);
    const currentId = draftBySlot.get(key);
    const candidates = candidatesBySlot.get(key) ?? [];
    pickerTitle.textContent = `${slotLabel(slot)}の講義`;
    removeButton.hidden = currentId === undefined;
    options.replaceChildren();

    for (const course of candidates) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const conflicts = conflictsWithDraft(course, currentId);
      button.type = "button";
      button.dataset.courseId = course.id;
      button.disabled = conflicts || course.id === currentId;
      button.textContent = `${course.name}（${course.credits}単位）`;
      if (conflicts) button.textContent += " · 他の登録講義と重複";
      if (course.id === currentId) button.textContent += " · 登録済み";
      item.appendChild(button);
      options.appendChild(item);
    }

    if (candidates.length === 0) {
      const item = document.createElement("li");
      item.textContent = "該当する講義がありません";
      options.appendChild(item);
    }

    picker.hidden = false;
    options.scrollTop = 0;
    positionPicker();
    const firstAction = options.querySelector("button:not(:disabled)") ?? closeButton;
    firstAction.focus({ preventScroll: true });
  });

  options.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-course-id]");
    if (!button || button.disabled) return;

    const course = courses.get(button.dataset.courseId);
    const currentId = draftBySlot.get(slotKey(selectedSlot()));
    if (currentId !== undefined) updateCourseSlots(courses.get(currentId));
    updateCourseSlots(course, course.id);
    closePicker(true);
  });

  removeButton.addEventListener("click", () => {
    const currentId = draftBySlot.get(slotKey(selectedSlot()));
    updateCourseSlots(courses.get(currentId));
    closePicker(true);
  });

  closeButton.addEventListener("click", () => closePicker(true));

  document.addEventListener("click", (event) => {
    if (selectedCell && !picker.contains(event.target) && !selectedCell.contains(event.target)) {
      closePicker(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selectedCell) {
      event.preventDefault();
      closePicker(true);
    }
  });

  window.addEventListener("resize", positionPicker);
  window.addEventListener("scroll", positionPicker, { capture: true, passive: true });
  bottomPanel.addEventListener("change", positionPicker);
}
