// 履修リスト：表示A＝科目リスト（学期プルダウン＋点数）、表示B＝既存の時間割（index.html）、右上＝卒業判定サイドバー
(() => {
  const COURSES = window.LIST_COURSES || [];
  const TERMS = ["1前", "1後", "2前", "2後", "3前", "3後", "4前", "4後"];
  const TERM_LABEL = (t) => `${t[0]}年${t[1]}期`;
  const PASS = 60; // 卒業判定Excelと同じく 60点以上で修得
  const STORAGE_KEY = "big6.listPlan.v2";
  const OLD_STORAGE_KEY = "big6.listPlan.v1";
  // シラバス詳細URL。semekikn(1=前期? 2=後期?) と crclumcd は未確認の推測値（シラバス取得/README.md 参照）
  const SYLLABUS_URL = (code, half) =>
    "https://gkmsyllabus.meijo-u.ac.jp/camweb/slbssbdr.do" +
    `?value(risyunen)=2026&value(semekikn)=${half === "前" ? 1 : 2}` +
    `&value(kougicd)=${encodeURIComponent(code)}&value(crclumcd)=12205`;

  const byId = new Map(COURSES.map((c) => [c.id, c]));

  // ---- 状態 ----
  // plan: { courseId: { term: "3前", score: 85 | null } }  score が null なら「予定」（Excelの "60" 扱い）
  const state = { grade: 3, plan: {}, search: "", dept: "", prog: "", show: "" };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const old = saved ? null : JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || "null");
    const src = saved || old;
    if (src && typeof src === "object") {
      if (src.grade) state.grade = src.grade;
      for (const [id, v] of Object.entries(src.plan || {})) {
        if (!byId.has(id)) continue;
        if (typeof v === "string") state.plan[id] = { term: v, score: null }; // v1 からの移行
        else if (v && TERMS.includes(v.term)) state.plan[id] = { term: v.term, score: v.score ?? null };
      }
    }
  } catch { /* 保存領域が使えなくても動く */ }
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ grade: state.grade, plan: state.plan }));
    } catch { /* noop */ }
  };

  // 状態の判定
  const statusOf = (p) => {
    if (!p) return { key: "", label: "" };
    if (p.score == null) return { key: "is-plan", label: "予定" };
    return p.score >= PASS ? { key: "is-pass", label: "修得" } : { key: "is-fail", label: "不可" };
  };
  const counts = (p) => p && (p.score == null || p.score >= PASS);

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const list = $("sheetBody");
  const popover = $("popover");
  const toast = $("toast");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmtCredit = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  for (const d of new Set(COURSES.map((c) => c.dept))) {
    const o = document.createElement("option");
    o.value = d; o.textContent = d;
    $("deptFilter").appendChild(o);
  }

  // 指定学期（前/後）の開講情報。時限が分かっているものを優先
  function offeringFor(course, half) {
    const sem = half === "前" ? "前期" : "後期";
    const offers = (course.offers || []).filter((o) => o.sem === sem);
    return offers.find((o) => o.period) || offers[0] || null;
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
    for (const t of c.terms) {
      const now = t[0] === String(state.grade) ? " is-now" : "";
      tags.push(`<span class="tag std${now}">標準 ${TERM_LABEL(t)}</span>`);
    }
    return tags.join("");
  }

  function rowHtml(c) {
    const p = state.plan[c.id];
    const st = statusOf(p);
    return `<div class="course ${st.key}" data-id="${c.id}">
      <div class="course-main">
        <button class="name-btn" data-detail="${c.id}">${esc(c.name)}</button>
        <div class="tags">${tagsHtml(c)}</div>
      </div>
      <div class="course-input">
        <select class="term-sel" aria-label="${esc(c.name)}の履修学期">${termOptions}</select>
        <input class="score" type="number" min="0" max="100" step="1" inputmode="numeric"
          placeholder="点数" aria-label="${esc(c.name)}の点数" ${p ? "" : "disabled"}
          value="${p && p.score != null ? p.score : ""}">
        <span class="status">${st.label}</span>
      </div>
    </div>`;
  }

  function visible(c) {
    if (state.dept && c.dept !== state.dept) return false;
    if (state.search.trim() && !c.name.includes(state.search.trim())) return false;
    if (state.prog && !c.prog[state.prog]) return false;
    if (state.show === "planned" && !state.plan[c.id]) return false;
    if (state.show === "unplanned" && state.plan[c.id]) return false;
    if (state.show === "grade" && !c.terms.some((t) => t[0] === String(state.grade))) return false;
    return true;
  }

  function renderList() {
    const html = [];
    let lastGroup = null;
    for (const c of COURSES) {
      if (!visible(c)) continue;
      const group = c.group ? `${c.dept}　${c.group}` : c.dept;
      if (group !== lastGroup) {
        html.push(`<div class="group-head">${esc(group)}</div>`);
        lastGroup = group;
      }
      html.push(rowHtml(c));
    }
    list.innerHTML = html.join("") || `<p class="empty">該当する科目がありません</p>`;
    // select の値は innerHTML 後に入れる
    list.querySelectorAll(".course").forEach((row) => {
      const p = state.plan[row.dataset.id];
      row.querySelector(".term-sel").value = p ? p.term : "";
    });
    renderTotal();
  }

  function renderTotal() {
    const entries = Object.entries(state.plan).map(([id, p]) => ({ c: byId.get(id), p })).filter((x) => x.c);
    const sum = (f) => entries.filter(f).reduce((s, x) => s + x.c.credits, 0);
    const passed = sum((x) => x.p.score != null && x.p.score >= PASS);
    const planned = sum((x) => x.p.score == null);
    $("sheetTotal").innerHTML = `修得 <strong>${fmtCredit(passed)}</strong> ＋ 予定 <strong>${fmtCredit(planned)}</strong> 単位`;
  }

  // 1行だけ更新（入力中のフォーカスを失わないように全体は描き直さない）
  function updateRow(id) {
    const row = list.querySelector(`.course[data-id="${id}"]`);
    if (!row) return;
    const p = state.plan[id];
    const st = statusOf(p);
    row.className = `course ${st.key}`;
    row.querySelector(".status").textContent = st.label;
    const score = row.querySelector(".score");
    score.disabled = !p;
    if (!p) score.value = "";
    renderTotal();
    if (!sidebar.hidden) renderSidebar();
  }

  list.addEventListener("change", (e) => {
    const row = e.target.closest(".course");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.classList.contains("term-sel")) {
      const term = e.target.value;
      if (term) state.plan[id] = { term, score: state.plan[id]?.score ?? null };
      else delete state.plan[id];
    } else if (e.target.classList.contains("score")) {
      if (!state.plan[id]) return;
      const raw = e.target.value.trim();
      const n = Math.round(Number(raw));
      if (raw === "" || Number.isNaN(n)) state.plan[id].score = null;
      else state.plan[id].score = Math.max(0, Math.min(100, n));
      e.target.value = state.plan[id].score ?? "";
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
    const nameBtn = e.target.closest("[data-detail]");
    if (nameBtn) {
      e.stopPropagation();
      openCourseDetail(byId.get(nameBtn.dataset.detail), nameBtn);
    }
  });

  // ---- 科目の詳細（科目名をタッチ → シラバスへ） ----
  function openCourseDetail(c, anchor) {
    const p = state.plan[c.id];
    const half = p ? p.term[1] : (c.terms[0] || "1前")[1];
    const o = offeringFor(c, half) || offeringFor(c, half === "前" ? "後" : "前");
    const progs = Object.entries(c.prog).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ");
    const syl = o?.code
      ? `<a href="${SYLLABUS_URL(o.code, o.sem === "前期" ? "前" : "後")}" target="_blank" rel="noopener">シラバスを開く</a>`
      : `<button disabled>シラバス情報なし</button>`;
    showPopover(`
      <h3>${esc(c.name)}</h3>
      <p class="meta">${esc(c.kind)} ${fmtCredit(c.credits)}単位 ／ 標準：${c.terms.map(TERM_LABEL).join("・") || "—"}</p>
      ${progs ? `<p class="meta">プログラム指定 ${esc(progs)}</p>` : ""}
      ${o ? `<p class="meta">${esc(o.sem)} ${esc(o.day || "")}${o.period ? o.period + "限" : ""} ${esc(o.room || "")} ${esc(o.teacher || "")}（${esc(o.code)}）</p>` : ""}
      <div class="actions">${syl}</div>`, anchor);
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
  $("grade").value = String(state.grade);
  $("grade").addEventListener("change", (e) => { state.grade = Number(e.target.value); save(); render(); });
  $("search").addEventListener("input", (e) => { state.search = e.target.value; renderList(); });
  $("deptFilter").addEventListener("change", (e) => { state.dept = e.target.value; renderList(); });
  $("progFilter").addEventListener("change", (e) => { state.prog = e.target.value; renderList(); });
  $("showFilter").addEventListener("change", (e) => { state.show = e.target.value; renderList(); });

  let toastTimer;
  document.querySelectorAll("[data-stub]").forEach((b) => b.addEventListener("click", () => {
    toast.textContent = `「${b.dataset.stub}」はまだ実装されていません`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
  }));

  // ---- 表示切替（A＝このリスト画面、B＝既存の index.html 時間割） ----
  const viewB = $("viewB");
  document.querySelectorAll(".view-tab[data-view]").forEach((tab) => tab.addEventListener("click", () => {
    const v = tab.dataset.view;
    document.querySelectorAll(".view-tab[data-view]").forEach((t) => {
      t.classList.toggle("is-active", t === tab);
      t.setAttribute("aria-selected", String(t === tab));
    });
    if (v === "B" && !viewB.src) viewB.src = "./index.html";
    viewB.hidden = v !== "B";
    app.classList.toggle("is-view-b", v === "B");
    hidePopover();
  }));

  // ---- 卒業判定サイドバー ----
  // 必要単位数は卒業判定Excelの各プログラムシート B19:B27（4プログラム共通、先進プロジェクトコース）
  const REQS = [
    ["総合基礎 選択必修", "総選", 10],
    ["総合基礎 合計", "総計", 20],
    ["理工基礎 指定", "理指", 8],
    ["理工基礎 選択必修", "理選", 12],
    ["専門 必修", "必", 21],
    ["プログラム指定 ◎", "◎", 14],
    ["プログラム指定 ※", "※", 9],
    ["プログラム指定 ○（※含む）", "○", 15],
    ["専門 合計", "専計", 104],
  ];
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
    const counted = Object.entries(state.plan)
      .map(([id, p]) => ({ c: byId.get(id), p })).filter((x) => x.c && counts(x.p));
    const sumTerms = (terms) => counted.filter((x) => terms.includes(x.p.term))
      .reduce((s, x) => s + x.c.credits, 0);
    const years = [
      ["1年", ["1前", "1後"]], ["2年", ["2前", "2後"]],
      ["3年前期", ["3前"]], ["3年後期", ["3後"]], ["4年", ["4前", "4後"]],
    ];
    const total = counted.reduce((s, x) => s + x.c.credits, 0);
    $("yearTable").innerHTML =
      years.map(([label, ts]) => `<tr><th>${label}</th><td>${fmtCredit(sumTerms(ts))} 単位</td></tr>`).join("") +
      `<tr class="total"><th>合計</th><td>${fmtCredit(total)} 単位</td></tr>`;

    const sumReq = (key) => counted.filter((x) => x.c.req.includes(key))
      .reduce((s, x) => s + x.c.credits, 0);
    $("progList").innerHTML = PROGRAMS.map(([p, name]) => {
      const rows = REQS.map(([label, key, need]) => {
        const got = sumReq(["◎", "※", "○"].includes(key) ? p + key : key);
        return { label, got, need };
      });
      const done = rows.every((r) => r.got >= r.need);
      return `<details class="prog" data-prog="${p}" ${openProgs.has(p) ? "open" : ""}>
        <summary>${p}<small class="prog-name">${name}</small>
          <span class="badge ${done ? "ok" : ""}">${done ? "修了" : "未充足"}</span></summary>
        <ul class="req-list">${rows.map((r) => `
          <li class="${r.got < r.need ? "short" : ""}"><span>${r.label}</span>
            <span class="val">${fmtCredit(r.got)} / ${r.need}</span>
            <progress value="${Math.min(r.got, r.need)}" max="${r.need}"></progress></li>`).join("")}
        </ul></details>`;
    }).join("");
  }
  $("progList").addEventListener("toggle", (e) => {
    const d = e.target.closest("details");
    if (d) d.open ? openProgs.add(d.dataset.prog) : openProgs.delete(d.dataset.prog);
  }, true);

  const setSidebar = (open) => {
    sidebar.hidden = !open;
    sidebarToggle.setAttribute("aria-expanded", String(open));
    if (open) renderSidebar();
  };
  sidebarToggle.addEventListener("click", (e) => { e.stopPropagation(); setSidebar(sidebar.hidden); });
  $("sidebarClose").addEventListener("click", () => setSidebar(false));

  function render() {
    renderList();
    if (!sidebar.hidden) renderSidebar();
  }
  render();
})();
