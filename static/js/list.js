// 履修リスト：科目リスト（学期プルダウン＋点数、再履修あり）と、右上ボタンで開く卒業判定サイドバー
// 予定・点数はブラウザ（localStorage）に保存し、別のタブで変わったら storage イベントで読み直す
(() => {
  // 学生便覧（2023〜2026年度）にあって、卒業判定 Excel（course-data.js）に無い自由科目。
  // 自由科目は卒業に必要な単位数に入らないので、記録用（req は空）
  const NO_PROG = { PC: "", DE: "", HM: "", NS: "" };
  const free = (id, name, group, term, extra = {}) => ({
    id, name, dept: "専門教育部門", group, kind: "自由", credits: 1, terms: [term],
    prog: NO_PROG, req: [], hidden: false, dsai: false, offers: [], extra: true, ...extra,
  });
  const EXTRA_COURSES = [
    free("x_math1", "数学基礎演習Ⅰ", "理工学基礎科目", "1前"),
    free("x_math2", "数学基礎演習Ⅱ", "理工学基礎科目", "1後"),
    free("x_phys1", "物理学基礎演習Ⅰ", "理工学基礎科目", "1前"),
    free("x_phys2", "物理学基礎演習Ⅱ", "理工学基礎科目", "1後"),
    free("x_chem1", "化学基礎演習Ⅰ", "理工学基礎科目", "1前"),
    free("x_chem2", "化学基礎演習Ⅱ", "理工学基礎科目", "1後"),
    free("x_eng1", "英語基礎演習Ⅰ", "理工学基礎科目", "1前"),
    free("x_eng2", "英語基礎演習Ⅱ", "理工学基礎科目", "1後"),
    free("x_mobileA", "モバイルアプリ開発A", "情報工学専門科目", "2後", { note: "夏期集中" }),
    // 2023年度入学は 2年後期、2024年度以降は 2年前期（便覧の教育課程一覧表）
    free("x_mobileB", "モバイルアプリ開発B", "情報工学専門科目", "2前", { note: "夏期集中", termsByYear: { 2023: ["2後"] } }),
  ];
  // 同じ系の最後の科目のうしろに差し込む（一覧の見出しが分かれないように）
  const ALL_COURSES = (() => {
    const list = [...(window.LIST_COURSES || [])];
    for (const x of EXTRA_COURSES) {
      let at = -1;
      list.forEach((c, i) => { if (c.dept === x.dept && c.group === x.group) at = i; });
      list.splice(at < 0 ? list.length : at + 1, 0, x);
    }
    return list;
  })();

  // ---- 先進プロジェクトコース／総合コース ----
  // scripts/data/excel_*.json の hidden の行は、卒業判定 Excel で隠されている総合コース用の行
  //（創造的思考法・PBL概論などは、先進では必修、総合では選必・選択になる）
  const COURSE_TYPES = { advanced: "先進プロジェクトコース", general: "総合コース" };
  const GENERAL_ONLY = new Set(ALL_COURSES.filter((c) => c.hidden).map((c) => c.id));
  // 先進コースだけの行：総合用の行と同じ名前の行と、「先進プロジェクト」で始まる科目
  const hiddenNames = new Set(ALL_COURSES.filter((c) => c.hidden).map((c) => c.name));
  const ADVANCED_ONLY = new Set(ALL_COURSES
    .filter((c) => !c.hidden && (hiddenNames.has(c.name) || c.name.startsWith("先進プロジェクト")))
    .map((c) => c.id));
  const inCourseType = (c, type) => (type === "general" ? !ADVANCED_ONLY.has(c.id) : !GENERAL_ONLY.has(c.id));

  // ---- 入学年度 ----
  // 2023〜2026年度の学生便覧を比べると、卒業に必要な単位数と科目はほぼ同じ。違いは次の1つだけ：
  // 2023年度入学の先進プロジェクトコースでは「情報技術の応用と職業」は総合コースのみの開講で、
  // 教職課程として履修はできるが、進級・卒業研究着手・卒業の単位には算入されない（2023年度便覧 2-24）
  const ENTRANCE_YEARS = [2023, 2024, 2025, 2026];
  const termsOf = (c) => c.termsByYear?.[state.entrance] || c.terms;
  const notCountedFor = (c, year, type) =>
    year === 2023 && type === "advanced" && !c.hidden && c.name === "情報技術の応用と職業";
  const YEAR = window.LIST_YEAR || 2026;
  const TERMS = ["1前", "1後", "2前", "2後", "3前", "3後", "4前", "4後"];
  const TERM_LABEL = (t) => `${t[0]}年${t[1]}期`;
  const PASS = 60; // 卒業判定Excelと同じく 60点以上で修得
  const STORAGE_KEY = "big6.listPlan.v3";
  const OLD_STORAGE_KEYS = ["big6.listPlan.v2", "big6.listPlan.v1"]; // 自動で v3 に移す
  // 名城大学シラバス（Campusmate-J）の詳細ページ。
  // semekikn・crclumcd は前期・後期とも 1・12205 で開ける
  const SYLLABUS_URL = (code) =>
    "https://gkmsyllabus.meijo-u.ac.jp/camweb/slbssbdr.do" +
    `?value(risyunen)=${YEAR}&value(semekikn)=1` +
    `&value(kougicd)=${encodeURIComponent(code)}&value(crclumcd)=12205`;

  // byId は両コースの全科目（コースを切り替えても予定・点数を残すため）
  const byId = new Map(ALL_COURSES.map((c) => [c.id, c]));

  // ---- 状態 ----
  // plan: { courseId: { attempts: [{ term: "1前", score: 45 }, { term: "2前", score: null }], code?: "642809" } }
  //   attempts は履修した回（再履修を含む）。学期順に並べる
  //   score が null の回は「予定」（Excelの "60" 扱い）。code は選んだクラスの講義コード（時間割画面で使う予定）
  const state = { term: "3前", entrance: 2025, courseType: "advanced", plan: {}, search: "", dept: "", prog: "", show: "" };
  // 今のコースで表示・集計する科目
  const courses = () => ALL_COURSES.filter((c) => inCourseType(c, state.courseType));
  const inCurrent = (c) => c && inCourseType(c, state.courseType);
  // 卒業判定・単位の集計に数えるか（今のコースの科目で、入学年度の決まりで除かれていないもの）
  const isCounted = (c) => inCurrent(c) && c.kind !== "自由" && !notCountedFor(c, state.entrance, state.courseType);
  const termIndex = (t) => TERMS.indexOf(t);
  const sortAttempts = (list) => list.sort((x, y) => termIndex(x.term) - termIndex(y.term));
  const cleanScore = (v) => (v == null || v === "" || Number.isNaN(Number(v))
    ? null : Math.max(0, Math.min(100, Math.round(Number(v)))));

  // 保存データ1件を新しい形にする（v1：学期だけ、v2：学期と点数1つ、v3：複数回）
  function normalizePlan(v) {
    if (typeof v === "string") return TERMS.includes(v) ? { attempts: [{ term: v, score: null }] } : null;
    if (!v || typeof v !== "object") return null;
    const raw = Array.isArray(v.attempts) ? v.attempts : [{ term: v.term, score: v.score }];
    const attempts = sortAttempts(raw.filter((a) => a && TERMS.includes(a.term))
      .map((a) => ({ term: a.term, score: cleanScore(a.score) })));
    if (!attempts.length) return null;
    const p = { attempts };
    if (v.code) p.code = v.code;
    return p;
  }

  function loadState() {
    state.plan = {};
    try {
      let src = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      for (const key of OLD_STORAGE_KEYS) {
        if (src) break;
        src = JSON.parse(localStorage.getItem(key) || "null");
      }
      if (!src || typeof src !== "object") return;
      if (TERMS.includes(src.term)) state.term = src.term;
      else if (src.grade) state.term = `${src.grade}前`; // 学年だけ保存していた旧形式
      if (COURSE_TYPES[src.courseType]) state.courseType = src.courseType;
      if (ENTRANCE_YEARS.includes(src.entrance)) state.entrance = src.entrance;
      for (const [id, v] of Object.entries(src.plan || {})) {
        if (!byId.has(id)) continue;
        const p = normalizePlan(v);
        if (p) state.plan[id] = p;
      }
    } catch { /* 保存領域が使えなくても動く */ }
  }
  loadState();
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ term: state.term, entrance: state.entrance, courseType: state.courseType, plan: state.plan }));
    } catch { /* noop */ }
  };

  // ---- 判定（Excel と同じく、再履修したら最高点で修得を判定する） ----
  const attemptStatus = (a) => {
    if (a.score == null) return { key: "is-plan", label: "予定" };
    return a.score >= PASS ? { key: "is-pass", label: "修得" } : { key: "is-fail", label: "不可" };
  };
  function summaryOf(p) {
    const attempts = p?.attempts || [];
    const scores = attempts.map((a) => a.score).filter((x) => x != null);
    const best = scores.length ? Math.max(...scores) : null;
    const earned = best != null && best >= PASS;
    const plannedAttempt = attempts.find((a) => a.score == null);
    // 単位を数える学期：修得した最初の回、まだなら予定の回
    const countTerm = earned ? attempts.find((a) => a.score != null && a.score >= PASS).term
      : plannedAttempt ? plannedAttempt.term : null;
    const status = !attempts.length ? { key: "", label: "" }
      : earned ? { key: "is-pass", label: "修得" }
      : plannedAttempt ? { key: "is-plan", label: "予定" }
      : { key: "is-fail", label: "不可" };
    const last = attempts[attempts.length - 1];
    // 最後の回が不可で、まだ修得していなければ再履修を追加できる
    const canRetake = !earned && !!last && last.score != null && last.score < PASS;
    return { attempts, best, earned, planned: !!plannedAttempt, countTerm, status, canRetake };
  }
  // 卒業判定に数えるか：修得済み、または予定がある（点数未入力の回がある）
  const counts = (p) => { const s = summaryOf(p); return s.earned || s.planned; };

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const list = $("sheetBody");
  const popover = $("popover");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmtCredit = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  for (const d of new Set(ALL_COURSES.map((c) => c.dept))) {
    const o = document.createElement("option");
    o.value = d; o.textContent = d;
    $("deptFilter").appendChild(o);
  }

  // ---- リスト ----
  const termOptions = `<option value="">未登録</option>` +
    TERMS.map((t) => `<option value="${t}">${TERM_LABEL(t)}</option>`).join("");

  function tagsHtml(c) {
    const tags = [`<span class="tag kind-${esc(c.kind)}">${esc(c.kind)} ${fmtCredit(c.credits)}単位</span>`];
    const progs = state.prog ? [state.prog] : ["PC", "DE", "HM", "NS"];
    for (const p of progs) {
      const m = c.prog[p];
      if (m && m !== "必") tags.push(`<span class="tag p-${esc(m)}">${p}${esc(m)}</span>`);
    }
    for (const t of termsOf(c)) {
      const now = t === state.term ? " is-now" : "";
      tags.push(`<span class="tag std${now}">標準 ${TERM_LABEL(t)}</span>`);
    }
    if (c.kind === "自由") tags.push(`<span class="tag free">卒業要件に数えない（自由科目）</span>`);
    if (c.note) tags.push(`<span class="tag">${esc(c.note)}</span>`);
    if (notCountedFor(c, state.entrance, state.courseType)) {
      tags.push(`<span class="tag not-counted">卒業要件に数えない（${state.entrance}年度入学）</span>`);
    }
    return tags.join("");
  }

  // その回の学期についての注意（開講していない学期・上の学年の授業）
  // 点数を入れた回は「実際に取った」記録なので出さない（時間割表は今年度のものだけで、過去の年度と違うことがある）
  function attemptWarning(c, a) {
    if (!a || a.score != null) return "";
    const sem = a.term[1] === "前" ? "前期" : "後期";
    const year = Number(a.term[0]);
    const offers = (c.offers || []).filter((o) => o.sem === sem || o.sem === "通年");
    if (c.offers?.length && !offers.length) {
      return `${sem}は開講していません（${YEAR}年度の時間割表）`;
    }
    // 上の学年の授業は履修できない（時間割表の学年。無ければ標準の学期の学年）
    const grades = offers.map((o) => o.grade).filter(Boolean);
    const minYear = grades.length ? Math.min(...grades) : Math.min(...termsOf(c).map((t) => Number(t[0])), 9);
    if (minYear !== 9 && year < minYear) return `${minYear}年次の科目です（上の学年の授業は履修できません）`;
    return "";
  }

  function attemptHtml(c, a, i, total) {
    const st = a ? attemptStatus(a) : { key: "", label: "" };
    const no = total > 1 ? `<span class="attempt-no">${i === 0 ? "初回" : `再履修${total > 2 ? i : ""}`}</span>` : "";
    const warn = attemptWarning(c, a);
    return `<div class="attempt ${st.key}" data-i="${i}">
        ${no}
        <select class="term-sel" data-i="${i}" aria-label="${esc(c.name)}の履修学期（${i + 1}回目）">${termOptions}</select>
        <input class="score" type="number" min="0" max="100" step="1" inputmode="numeric" data-i="${i}"
          placeholder="点数" aria-label="${esc(c.name)}の点数（${i + 1}回目）" ${a ? "" : "disabled"}
          value="${a && a.score != null ? a.score : ""}">
        <span class="status">${st.label}</span>
      </div>${warn ? `<p class="attempt-warn">⚠ ${esc(warn)}</p>` : ""}`;
  }

  function rowHtml(c) {
    const s = summaryOf(state.plan[c.id]);
    const attempts = s.attempts.length ? s.attempts : [null];
    return `<div class="course ${s.status.key}" data-id="${c.id}">
      <div class="course-main">
        <button class="name-btn" data-detail="${c.id}">${esc(c.name)}</button>
        <div class="tags">${tagsHtml(c)}</div>
      </div>
      <div class="course-input">
        ${attempts.map((a, i) => attemptHtml(c, a, i, s.attempts.length)).join("")}
        ${s.canRetake ? `<button class="retake-btn" data-retake="${c.id}">＋ 再履修を追加</button>` : ""}
      </div>
    </div>`;
  }

  // innerHTML のあとに、各回の学期を select に入れる
  function fillSelects(row) {
    const attempts = state.plan[row.dataset.id]?.attempts || [];
    row.querySelectorAll(".term-sel").forEach((sel) => {
      sel.value = attempts[Number(sel.dataset.i)]?.term || "";
    });
  }

  function visible(c) {
    if (state.dept && c.dept !== state.dept) return false;
    if (state.search.trim() && !c.name.includes(state.search.trim())) return false;
    if (state.prog && !c.prog[state.prog]) return false;
    if (state.show === "planned" && !state.plan[c.id]) return false;
    if (state.show === "unplanned" && state.plan[c.id]) return false;
    if (state.show === "grade" && !termsOf(c).includes(state.term)) return false;
    return true;
  }

  function renderList() {
    const html = [];
    let lastGroup = null;
    for (const c of courses()) {
      if (!visible(c)) continue;
      const group = c.group ? `${c.dept}　${c.group}` : c.dept;
      if (group !== lastGroup) {
        html.push(`<div class="group-head">${esc(group)}</div>`);
        lastGroup = group;
      }
      html.push(rowHtml(c));
    }
    list.innerHTML = html.join("") || `<p class="empty">該当する科目がありません</p>`;
    list.querySelectorAll(".course").forEach(fillSelects);
    renderTotal();
  }

  function renderTotal() {
    const entries = Object.entries(state.plan).map(([id, p]) => ({ c: byId.get(id), p })).filter((x) => isCounted(x.c));
    const sum = (f) => entries.filter(f).reduce((s, x) => s + x.c.credits, 0);
    const passed = sum((x) => summaryOf(x.p).earned);
    const planned = sum((x) => { const s = summaryOf(x.p); return !s.earned && s.planned; });
    $("sheetTotal").innerHTML = `修得 <strong>${fmtCredit(passed)}</strong> ＋ 予定 <strong>${fmtCredit(planned)}</strong> 単位`;
  }

  // 1科目分だけ描き直す（全体は描き直さない）。入力中の欄にフォーカスを戻す
  function updateRow(id) {
    const row = list.querySelector(`.course[data-id="${id}"]`);
    if (row) {
      const f = document.activeElement;
      const focus = row.contains(f) && f.dataset.i != null ? { cls: f.classList[0], i: f.dataset.i } : null;
      const tmp = document.createElement("div");
      tmp.innerHTML = rowHtml(byId.get(id));
      const fresh = tmp.firstElementChild;
      row.replaceWith(fresh);
      fillSelects(fresh);
      if (focus) fresh.querySelector(`.${focus.cls}[data-i="${focus.i}"]`)?.focus();
    }
    renderTotal();
    if (!sidebar.hidden) renderSidebar();
  }

  list.addEventListener("change", (e) => {
    const row = e.target.closest(".course");
    if (!row || e.target.dataset.i == null) return;
    const id = row.dataset.id;
    const i = Number(e.target.dataset.i);
    const p = state.plan[id];
    if (e.target.classList.contains("term-sel")) {
      const term = e.target.value;
      if (!term) {
        // 「未登録」にした回を消す。全部なくなれば科目ごと消す
        if (p) p.attempts.splice(i, 1);
        if (!p || !p.attempts.length) delete state.plan[id];
      } else if (!p) {
        state.plan[id] = { attempts: [{ term, score: null }] };
      } else if (p.attempts.some((a, j) => j !== i && a.term === term)) {
        // 同じ科目で同じ学期の回は作らない
        e.target.value = p.attempts[i]?.term || "";
        showToast(`${TERM_LABEL(term)}の回はすでにあります`);
        return;
      } else {
        p.attempts[i] = { term, score: p.attempts[i]?.score ?? null };
        sortAttempts(p.attempts);
        delete p.code; // 学期を変えたらクラスの選択は選び直し
      }
    } else if (e.target.classList.contains("score")) {
      if (!p?.attempts[i]) return;
      p.attempts[i].score = cleanScore(e.target.value.trim());
    }
    save();
    // 絞り込み中に条件から外れる変更なら全体を描き直す
    if (state.show === "planned" || state.show === "unplanned") renderList();
    else updateRow(id);
  });
  list.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("score")) e.target.blur();
  });
  list.addEventListener("click", (e) => {
    const retake = e.target.closest("[data-retake]");
    if (retake) {
      // 再履修：最後の回の次の学期を初期値にして、1回分足す
      const id = retake.dataset.retake;
      const attempts = state.plan[id].attempts;
      const next = TERMS[Math.min(termIndex(attempts[attempts.length - 1].term) + 1, TERMS.length - 1)];
      attempts.push({ term: next, score: null });
      sortAttempts(attempts);
      save();
      updateRow(id);
      list.querySelector(`.course[data-id="${id}"] .term-sel[data-i="${attempts.length - 1}"]`)?.focus();
      return;
    }
    const nameBtn = e.target.closest("[data-detail]");
    if (nameBtn) {
      e.stopPropagation();
      openCourseDetail(byId.get(nameBtn.dataset.detail), nameBtn);
    }
  });

  // ---- 科目の詳細（科目名をタッチ → シラバスへ） ----
  // 開講枠1つを「A 水3・4限 隔週A N-324 担当」のような1行にする
  function offerLine(o) {
    const slots = (o.slots || []).length
      ? `${o.slots[0].day}${o.slots.map((x) => x.period).join("・")}限`
      : `${o.day || ""}${o.period ? o.period + "限" : "（時限未定）"}`;
    const tags = [
      o.retake ? "再履修" : o.cls ? `${o.cls}クラス` : "",
      o.biweekly ? `隔週${o.biweekly}` : "",
    ].filter(Boolean).join("・");
    return `<li><a href="${SYLLABUS_URL(o.code)}" target="_blank" rel="noopener">
        <strong>${esc(slots)}</strong> ${esc(o.room || "")}
        <small>${tags ? esc(tags) + " ／ " : ""}${esc(o.teacher || "")}（${esc(o.code)}）${o.note ? "<br>" + esc(o.note) : ""}</small>
      </a></li>`;
  }

  // ---- 科目の詳細（科目名をタッチ → 開講クラスとシラバス） ----
  function openCourseDetail(c, anchor) {
    const s = summaryOf(state.plan[c.id]);
    const term = s.attempts.length ? s.attempts[s.attempts.length - 1].term : c.terms[0];
    const history = s.attempts.map((a) => `${TERM_LABEL(a.term)} ${a.score == null ? "予定" : `${a.score}点`}`).join("、");
    const progs = Object.entries(c.prog).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ");
    const bySem = { 前期: [], 後期: [], 通年: [] };
    for (const o of c.offers || []) (bySem[o.sem] ||= []).push(o);
    // 履修予定（なければ標準）の学期を先に出す
    const first = term && term[1] === "後" ? "後期" : "前期";
    const order = [first, first === "前期" ? "後期" : "前期", "通年"];
    const sections = order.filter((sem) => bySem[sem]?.length).map((sem) =>
      `<p class="meta sem">${sem}の開講クラス（タッチでシラバス）</p><ul class="offers">${bySem[sem].map(offerLine).join("")}</ul>`
    ).join("");
    showPopover(`
      <h3>${esc(c.name)}</h3>
      <p class="meta">${esc(c.kind)} ${fmtCredit(c.credits)}単位 ／ 標準：${c.terms.map(TERM_LABEL).join("・") || "—"}</p>
      ${history ? `<p class="meta">履修：${esc(history)}</p>` : ""}
      ${progs ? `<p class="meta">プログラム指定 ${esc(progs)}</p>` : ""}
      ${sections || `<p class="empty">${window.LIST_YEAR || ""}年度の時間割表に開講情報がありません</p>`}`, anchor);
  }


  function showPopover(html, anchor) {
    popover.innerHTML = html;
    popover.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = popover.offsetWidth, h = popover.offsetHeight;
    const left = Math.min(r.left, window.innerWidth - w - 8);
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    popover.style.left = `${Math.max(8, left)}px`;
    popover.style.top = `${top}px`;
  }
  const hidePopover = () => { popover.hidden = true; };
  document.addEventListener("click", (e) => {
    if (!popover.hidden && !popover.contains(e.target)) hidePopover();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePopover(); });
  $("sheetScroll").addEventListener("scroll", hidePopover);

  // ---- 上部バー・絞り込み ----
  // 上部バーの学年・学期
  const termSel = $("headerTerm");
  termSel.value = state.term;
  termSel.addEventListener("change", () => { state.term = termSel.value; save(); render(); });
  const entranceSel = $("entranceYear");
  entranceSel.value = String(state.entrance);
  entranceSel.addEventListener("change", () => {
    state.entrance = Number(entranceSel.value);
    save();
    hidePopover();
    render();
  });
  const courseSel = $("courseType");
  courseSel.value = state.courseType;
  courseSel.addEventListener("change", () => {
    state.courseType = courseSel.value;
    save();
    hidePopover();
    render();
  });
  $("search").addEventListener("input", (e) => { state.search = e.target.value; renderList(); });
  $("deptFilter").addEventListener("change", (e) => { state.dept = e.target.value; renderList(); });
  $("progFilter").addEventListener("change", (e) => { state.prog = e.target.value; renderList(); });
  $("showFilter").addEventListener("change", (e) => { state.show = e.target.value; renderList(); });

  // 未実装のボタン（表示B・C、送信、読込）はトーストで知らせる
  const toast = $("toast");
  let toastTimer;
  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
  }
  document.querySelectorAll("[data-stub]").forEach((b) => b.addEventListener("click", () => {
    showToast(`「${b.dataset.stub}」はまだ実装されていません`);
  }));

  // ---- 卒業判定サイドバー ----
  // 必要単位数は scripts/data/excel_*.json の requirements（プログラムごとに下の9項目の順）
  const REQS = [
    ["総合基礎 選択必修", "総選"],
    ["総合基礎 合計", "総計"],
    ["理工基礎 指定", "理指"],
    ["理工基礎 選択必修", "理選"],
    ["専門 必修", "必"],
    ["プログラム指定 ◎", "◎"],
    ["プログラム指定 ※", "※"],
    ["プログラム指定 ○（※含む）", "○"],
    ["専門 合計", "専計"],
  ];
  // 先進：scripts/data/excel_*.json の requirements。総合：卒業判定 Excel の各プログラムシート O列「総合コース用」
  //（専門必修 21→10、◎ 14→16、○ 15→20。4プログラムとも同じ）
  const REQUIREMENTS = {
    advanced: window.LIST_REQUIREMENTS || {},
    general: Object.fromEntries(["PC", "DE", "HM", "NS"].map((p) => [p, [10, 20, 8, 12, 10, 16, 9, 20, 104]])),
  };
  const PROGRAMS = [
    ["PC", "フィジカルコンピューティング"],
    ["DE", "データエンジニアリング"],
    ["HM", "ヒューマン・メディア"],
    ["NS", "ネットワークシステム"],
  ];
  const sidebar = $("sidebar");
  const sidebarToggle = $("sidebarToggle");
  const openProgs = new Set(["DE"]);

  function renderSidebar() {
    $("sidebarCourse").textContent = `${state.entrance}年度入学・${COURSE_TYPES[state.courseType]}`;
    const counted = Object.entries(state.plan)
      .map(([id, p]) => ({ c: byId.get(id), p })).filter((x) => isCounted(x.c) && counts(x.p));
    const sumTerms = (terms) => counted.filter((x) => terms.includes(summaryOf(x.p).countTerm))
      .reduce((s, x) => s + x.c.credits, 0);
    // 学年ごとに 前期・後期 の2行。左の学年セルに年間の小計を出す
    const total = counted.reduce((s, x) => s + x.c.credits, 0);
    let rows = `<tr><th>学年</th><th>学期</th><th class="num">単位</th></tr>`;
    for (const y of ["1", "2", "3", "4"]) {
      ["前", "後"].forEach((h, i) => {
        const t = y + h;
        const cur = t === state.term ? ' class="is-current"' : "";
        const yearCell = i === 0
          ? `<th rowspan="2" class="year">${y}年<small>${fmtCredit(sumTerms([y + "前", y + "後"]))} 単位</small></th>`
          : "";
        rows += `<tr${cur}>${yearCell}<td class="half">${h}期</td><td>${fmtCredit(sumTerms([t]))} 単位</td></tr>`;
      });
    }
    rows += `<tr class="total"><th colspan="2">合計</th><td>${fmtCredit(total)} 単位</td></tr>`;
    $("yearTable").innerHTML = rows;

    const all = evaluate(null);
    $("judgeList").innerHTML = judgmentsHtml(all);
    $("progList").innerHTML = all.programs.map(({ p, name, rows, done, needed }) => `
      <details class="prog" data-prog="${p}" ${openProgs.has(p) ? "open" : ""}>
        <summary>${p}<small class="prog-name">${name}</small>
          <span class="badge ${done ? "ok" : ""}">${done ? "修了" : `残り最低${fmtCredit(needed)}科目`}</span></summary>
        <ul class="req-list">${rows.map((r) => `
          <li class="${r.got < r.need ? "short" : ""}"><span>${r.label}</span>
            <span class="val">${fmtCredit(r.got)} / ${r.need}</span>
            <progress value="${Math.min(r.got, r.need)}" max="${r.need}"></progress></li>`).join("")}
        </ul></details>`).join("");
  }

  // ---- 判定の計算（卒業判定 Excel「総合判定」「PC/DE/HM/NS」シートと同じ式） ----
  // upto：この学期までに修得・予定の科目だけで数える（null なら全部）
  function evaluate(upto) {
    const limit = upto ? termIndex(upto) : Infinity;
    const within = (p) => { const t = summaryOf(p).countTerm; return t != null && termIndex(t) <= limit; };
    const counted = Object.entries(state.plan)
      .map(([id, p]) => ({ c: byId.get(id), p })).filter((x) => isCounted(x.c) && counts(x.p) && within(x.p));
    const countedIds = new Set(counted.map((x) => x.c.id));
    const sumReq = (key) => counted.filter((x) => x.c.req.includes(key)).reduce((s, x) => s + x.c.credits, 0);
    // まだ数えられない必修科目の数（Excel の M23：必修科目の不足科目数）
    const requiredMissing = courses().filter((c) => c.req.includes("必") && !countedIds.has(c.id)).length;
    const programs = PROGRAMS.map(([p, name]) => {
      const rows = REQS.map(([label, key], i) => ({
        label,
        need: REQUIREMENTS[state.courseType][p]?.[i] ?? 0,
        got: sumReq(["◎", "※", "○"].includes(key) ? p + key : key),
      }));
      const b = rows.map((r) => r.need), c = rows.map((r) => r.got);
      const l = b.map((v, i) => Math.max(v - c[i], 0));
      const up = Math.ceil;
      // 不足科目数の推定（Excel M19〜M27。1科目＝2単位として計算）
      const m = [];
      m[0] = l[0];
      m[1] = l[0] === 0 ? up(Math.max((b[1] - c[1]) / 2, 0)) : up(Math.max(0, (10 + c[0] - c[1]) / 2));
      m[2] = l[2] / 2;
      m[3] = l[2] >= l[3] ? 0 : up((l[3] - l[2]) / 2);
      m[4] = requiredMissing;
      m[5] = l[5] / 2;
      m[6] = up(l[6] / 2);
      m[7] = up(Math.max(0, (l[7] - m[6] * 2) / 2));
      m[8] = up(Math.max(0, (l[8] - l[2] - m[3] * 2 - l[4] - l[5] - m[6] * 2 - m[7] * 2) / 2));
      return { p, name, rows, done: rows.every((r) => r.got >= r.need), needed: m.reduce((a, v) => a + v, 0) };
    });
    return {
      programs,
      totalUnits: sumReq("総計") + sumReq("専計"),
      infoBasic: counted.filter((x) => x.c.req.includes("基礎")).length,
      dsai: counted.filter((x) => x.c.dsai).length,
      minNeeded: Math.min(...programs.map((x) => x.needed)),
    };
  }

  // 進級・研究ゼミナール・卒業研究着手・卒業・DS・AI（Excel「総合判定」シート、学生便覧の条件）
  // metrics：プログレスバーにする値。less: true は「need 以下なら充足」（残り科目数など）
  function judgmentsHtml(all) {
    const adv = evaluate("2後");    // 3年次への進級：2年次終了まで
    const semi = evaluate("3前");   // 研究ゼミナール（3年後期）：履修開始時まで
    const thesis = evaluate("3後"); // 卒業研究（4年）：着手時まで
    const items = [];
    items.push({
      title: "3年次への進級", ok: adv.infoBasic >= 3 && adv.totalUnits >= 62, note: "2年後期までの修得で判定",
      metrics: [
        { label: "情報工学基礎科目", got: adv.infoBasic, need: 3, unit: "科目" },
        { label: "修得単位数", got: adv.totalUnits, need: 62, unit: "単位" },
      ],
    });
    // 2024年度入学以降：卒業研究を履修中・修得済みなら研究ゼミナールは履修できない
    const semiCourse = courses().find((c) => c.name === "研究ゼミナール");
    const thesisCourse = courses().find((c) => c.name === "卒業研究");
    const semiTerm = semiCourse && state.plan[semiCourse.id]?.attempts[0]?.term;
    const thesisTerm = thesisCourse && state.plan[thesisCourse.id]?.attempts[0]?.term;
    const blocked = state.entrance >= 2024 && semiTerm && thesisTerm && termIndex(thesisTerm) <= termIndex(semiTerm);
    items.push({
      title: "研究ゼミナールの履修", ok: semi.totalUnits >= 85 && !blocked,
      note: "3年前期までの修得で判定" + (blocked ? "。卒業研究を履修中・修得済みの学期には履修できません" : ""),
      metrics: [{ label: "修得単位数", got: semi.totalUnits, need: 85, unit: "単位" }],
    });
    items.push({
      title: "卒業研究の着手", ok: thesis.minNeeded <= 10, note: "3年後期までの修得で判定",
      metrics: [{ label: "卒業まで残り最低", got: thesis.minNeeded, need: 10, unit: "科目", less: true }],
    });
    // 卒業：どれか1つのプログラムを修了すればよいので、4プログラムの9項目の充足数を並べる
    const doneProgs = all.programs.filter((x) => x.done).map((x) => x.p);
    items.push({
      title: "卒業", ok: doneProgs.length > 0,
      note: doneProgs.length ? `${doneProgs.join("・")} プログラム修了` : `いずれか1つのプログラムの修了が必要（残り最低 ${fmtCredit(all.minNeeded)} 科目）`,
      metrics: all.programs.map((x) => ({
        label: `${x.p} 修了要件`, got: x.rows.filter((r) => r.got >= r.need).length, need: 9, unit: "項目",
      })),
    });
    items.push({
      title: "DS・AI サブカリキュラム", ok: all.dsai >= 7, optional: true, note: "登録者のみ",
      metrics: [{ label: "対象科目", got: all.dsai, need: 7, unit: "科目" }],
    });

    const bar = (m) => {
      // 「以下なら充足」の値は、need を超えた分だけ短くする（例：残り20科目なら 10/20）
      const ok = m.less ? m.got <= m.need : m.got >= m.need;
      const value = m.less ? (m.got <= m.need ? 1 : m.need / m.got) : Math.min(m.got / m.need, 1);
      return `<li class="${ok ? "" : "short"}"><span>${m.label}</span>
          <span class="val">${fmtCredit(m.got)}${m.less ? `（${m.need}以内）` : ` / ${m.need}`} ${m.unit}</span>
          <progress value="${value}" max="1"></progress></li>`;
    };
    return items.map((x) => `
      <li class="${x.ok ? "ok" : "ng"}">
        <div class="judge-top">
          <span class="judge-title">${x.title}</span>
          <span class="badge ${x.ok ? "ok" : ""}">${x.ok ? (x.optional ? "認定" : "可") : (x.optional ? "未認定" : "未充足")}</span>
        </div>
        <ul class="req-list">${x.metrics.map(bar).join("")}</ul>
        <small>${esc(x.note)}</small>
      </li>`).join("");
  }

  $("progList").addEventListener("toggle", (e) => {
    const d = e.target.closest("details");
    if (d) d.open ? openProgs.add(d.dataset.prog) : openProgs.delete(d.dataset.prog);
  }, true);

  const setSidebar = (open) => {
    sidebar.hidden = !open;
    app.classList.toggle("has-sidebar", open);
    sidebarToggle.setAttribute("aria-expanded", String(open));
    if (open) renderSidebar();
  };
  sidebarToggle.addEventListener("click", (e) => { e.stopPropagation(); setSidebar(sidebar.hidden); });
  $("sidebarClose").addEventListener("click", () => setSidebar(false));

  // 別のタブ・画面が保存データを変えたら読み直す
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    loadState();
    termSel.value = state.term;
    courseSel.value = state.courseType;
    entranceSel.value = String(state.entrance);
    render();
  });

  // ---- PDF の読み取り（成績通知書・履修登録科目確認通知書） ----
  // 読み取りは src/pdf-import.js。PDF はブラウザの中だけで読み、どこにも送らない
  const importDialog = $("importDialog");
  const importBody = $("importBody");
  let importResult = null;

  $("pdfImportBtn").addEventListener("click", () => $("pdfInput").click());
  $("pdfInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // 同じファイルをもう一度選べるように
    if (!file) return;
    importBody.innerHTML = `<h2 id="importTitle">PDF を読み取っています…</h2><p class="import-meta">${esc(file.name)}</p>`;
    importDialog.showModal();
    try {
      importResult = await window.PdfImport.read(file, {
        courses: ALL_COURSES, inCourseType, fallbackType: state.courseType,
      });
      renderImport();
    } catch (err) {
      importBody.innerHTML = `<h2 id="importTitle">読み取れませんでした</h2>
        <p class="import-meta">${esc(err.message || String(err))}</p>
        <div class="import-actions"><button value="cancel">閉じる</button></div>`;
    }
  });

  function renderImport() {
    const r = importResult;
    if (!r.kind || !r.rows.length) {
      importBody.innerHTML = `<h2 id="importTitle">取り込める内容が見つかりませんでした</h2>
        <p class="import-meta">名城大学の「試験成績一覧表」または「履修登録科目確認通知書」の PDF を選んでください。</p>
        <div class="import-actions"><button value="cancel">閉じる</button></div>`;
      return;
    }
    const meta = [
      r.issued && `発行日 ${r.issued}`,
      r.entrance && `${r.entrance}年度入学`,
      r.courseType && COURSE_TYPES[r.courseType],
    ].filter(Boolean).join("・");
    const changeMeta = (r.entrance && r.entrance !== state.entrance) || (r.courseType && r.courseType !== state.courseType);
    const ok = r.rows.filter((x) => !x.problem).length;
    importBody.innerHTML = `
      <h2 id="importTitle">${esc(r.title)}の読み取り結果</h2>
      <p class="import-meta">${esc(meta)} ／ ${r.rows.length}行のうち ${ok}行を取り込めます</p>
      <p class="import-meta">${r.kind === "grades"
        ? "点数のある科目は、その学期の点数として入れます（同じ学期の回があれば上書き）。「履修中」は予定として入れます。"
        : "登録した科目を、その学期の予定として入れます（点数が入っている回はそのまま）。"}</p>
      ${changeMeta ? `<label class="import-check"><input type="checkbox" id="importMeta" checked>
        入学年度とコースを PDF に合わせる（今：${state.entrance}年度入学・${COURSE_TYPES[state.courseType]}）</label>` : ""}
      <div class="import-table-wrap"><table class="import-table">
        <thead><tr><th></th><th>PDF の科目名</th><th>このアプリの科目</th><th>学期</th><th>結果</th></tr></thead>
        <tbody>${r.rows.map((x, i) => `
          <tr class="${x.problem ? "is-ng" : ""}">
            <td><input type="checkbox" data-row="${i}" ${x.problem ? "disabled" : "checked"} aria-label="${esc(x.pdfName)}を取り込む"></td>
            <td>${esc(x.pdfName)}</td>
            <td>${x.course ? esc(x.course.name) : "—"}</td>
            <td>${x.term ? TERM_LABEL(x.term) : "—"}</td>
            <td>${esc(x.problem || x.note || (x.score != null ? `${x.score}点` : x.result))}</td>
          </tr>`).join("")}</tbody>
      </table></div>
      <div class="import-actions">
        <button value="cancel">やめる</button>
        <button value="apply" class="primary" id="importApply">取り込む</button>
      </div>`;
  }

  // 「取り込む」「やめる」はどちらもフォームの送信（method="dialog"）でダイアログを閉じる。
  // 閉じたあとの close イベントは環境によって届かないことがあるので、送信の時点で取り込む
  importBody.addEventListener("submit", (e) => {
    if (e.submitter?.value === "apply" && importResult) applyImport();
    importResult = null;
  });

  function applyImport() {
    const r = importResult;
    if ($("importMeta")?.checked) {
      if (r.entrance && ENTRANCE_YEARS.includes(r.entrance)) state.entrance = r.entrance;
      if (r.courseType) state.courseType = r.courseType;
      entranceSel.value = String(state.entrance);
      courseSel.value = state.courseType;
    }
    let count = 0;
    importBody.querySelectorAll("input[data-row]:checked").forEach((box) => {
      const x = r.rows[Number(box.dataset.row)];
      if (!x || x.problem) return;
      const p = (state.plan[x.course.id] ||= { attempts: [] });
      const same = p.attempts.find((a) => a.term === x.term);
      if (r.kind === "grades") {
        // 点数はその学期の回に入れる（履修中なら予定のまま）
        if (same) { if (x.score != null) same.score = x.score; }
        else p.attempts.push({ term: x.term, score: x.score });
      } else if (!same) {
        p.attempts.push({ term: x.term, score: null });
      }
      if (x.code) p.code = x.code;
      sortAttempts(p.attempts);
      count++;
    });
    save();
    render();
    showToast(`${count}科目を取り込みました`);
  }

  function render() {
    renderList();
    if (!sidebar.hidden) renderSidebar();
  }
  render();
})();
