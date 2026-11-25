import { ListApi } from "../js/list-api.js";
import {
  COURSE_TYPES, PROGRAMS, REQS, evaluate, fmtCredit, makeContext, readSavedPlan, summaryOf,
} from "../js/list-rules.js";

const programSelect = document.getElementById("requirements-program");
const profile = document.getElementById("requirements-profile");
const status = document.getElementById("requirements-status");
const note = document.getElementById("requirements-note");
const shortfalls = document.getElementById("requirements-shortfalls");
const items = [...document.querySelectorAll(".requirements-card .credit-item")];
const programKeys = new Set(["◎", "※", "○"]);

for (const [id, name] of PROGRAMS) {
  programSelect.add(new Option(`${id} — ${name}`, id));
}
programSelect.value = "DE";

async function loadRequirements() {
  try {
    const [catalog, saved] = await Promise.all([ListApi.getCourses(), ListApi.getPlan()]);
    const allCourses = catalog.courses;
    const byId = new Map(allCourses.map((course) => [course.id, course]));
    const {
      courseType = "advanced", entrance = 2025, plan,
    } = readSavedPlan(saved, new Set(byId.keys()));
    const rules = catalog.rules;
    if (!PROGRAMS.every(([id]) => {
      const units = rules.requirements[courseType]?.[id];
      return units?.length === REQS.length && units.every(Number.isFinite);
    })) throw new Error("必要単位数がそろっていません");

    // 履修予定を除き、修得した科目だけで卒業要件カードを表示する。
    const earnedPlan = Object.fromEntries(Object.entries(plan).filter(([, entry]) => summaryOf(entry).earned));
    const context = makeContext({ allCourses, byId, plan: earnedPlan, courseType, entrance, rules });
    const { programs } = evaluate(context, null);
    const subjectLists = items.map((item, index) => {
      const [, key] = REQS[index];
      if (key === "総計" || key === "専計") return null;

      const details = document.createElement("details");
      details.className = "credit-subjects";
      const summary = document.createElement("summary");
      summary.textContent = "対象科目";
      const list = document.createElement("ul");
      details.append(summary, list);
      item.appendChild(details);
      return list;
    });

    function render() {
      const { p, name, rows, done } = programs.find(({ p }) => p === programSelect.value);
      profile.textContent = `${name}（${p}）／ ${COURSE_TYPES[courseType]}`;
      status.textContent = done ? "充足" : "未充足";
      status.classList.toggle("is-complete", done);
      shortfalls.replaceChildren();
      shortfalls.parentElement.hidden = done;
      rows.forEach(({ label, need, got }, index) => {
        const item = items[index];
        const progress = item.querySelector("progress");
        progress.max = need || 1;
        progress.value = need ? got : 1;
        item.querySelector(".credit-count").textContent = `${fmtCredit(got)} / ${fmtCredit(need)}`;
        item.classList.toggle("is-short", got < need);
        if (got < need) {
          const li = document.createElement("li");
          li.textContent = `${label}：${fmtCredit(need - got)} 単位`;
          shortfalls.appendChild(li);
        }

        const list = subjectLists[index];
        if (!list) return;
        const [, key] = REQS[index];
        const requirement = programKeys.has(key) ? p + key : key;
        const subjects = context.courses.filter((course) => context.isCounted(course) && course.req.includes(requirement));
        list.replaceChildren(...subjects.map((course) => {
          const li = document.createElement("li");
          li.textContent = course.name;
          return li;
        }));
        list.parentElement.hidden = subjects.length === 0;
      });
    }

    render();
    programSelect.disabled = false;
    programSelect.addEventListener("change", render);
  } catch (error) {
    status.textContent = "表示できません";
    note.textContent = "科目データまたは履修計画を読み込めませんでした。";
    console.error(error);
  }
}

loadRequirements();
