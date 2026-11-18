// 履修リスト：表示A＝成績表風リスト、表示B＝既存の時間割（index.html）、右上＝卒業判定サイドバー
(() => {
  const COURSES = window.LIST_COURSES || [];
  const TERMS = ["1前", "1後", "2前", "2後", "3前", "3後", "4前", "4後"];
  const STORAGE_KEY = "big6.listPlan.v1";
  // シラバス詳細URL。semekikn(1=前期? 2=後期?) と crclumcd は未確認の推測値（シラバス取得/README.md 参照）
  const SYLLABUS_URL = (code, half) =>
    "https://gkmsyllabus.meijo-u.ac.jp/camweb/slbssbdr.do" +
    `?value(risyunen)=2026&value(semekikn)=${half === "前" ? 1 : 2}` +
    `&value(kougicd)=${encodeURIComponent(code)}&value(crclumcd)=12205`;

  const byId = new Map(COURSES.map((c) => [c.id, c]));

  // ---- 状態 ----
  const state = {
    grade: 3,
    plan: {}, // { courseId: "3前" }
    search: "",
    dept: "",
    prog: "",
    onlyPlanned: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") {
      if (saved.grade) state.grade = saved.grade;
      if (saved.plan && typeof saved.plan === "object") state.plan = saved.plan;
    }
  } catch { /* 保存領域が使えなくても動く */ }
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ grade: state.grade, plan: state.plan }));
    } catch { /* noop */ }
  };
  const isCurrentTerm = (t) => t[0] === String(state.grade);

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const sheetBody = $("sheetBody");
  const popover = $("popover");
  const toast = $("toast");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmtCredit = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // 部門フィルタの選択肢
  for (const d of new Set(COURSES.map((c) => c.dept))) {
    const o = document.createElement("option");
    o.value = d; o.textContent = d;
    $("deptFilter").appendChild(o);
  }

  function setPlan(courseId, term) {
    if (term) state.plan[courseId] = term;
    else delete state.plan[courseId];
    save();
    render();
  }

  // 指定学期（前/後）の開講情報。時限が分かっているものを優先
  function offeringFor(course, half) {
    const sem = half === "前" ? "前期" : "後期";
    const offers = (course.offers || []).filter((o) => o.sem === sem);
    return offers.find((o) => o.period) || offers[0] || null;
  }

  // ---- 成績表 ----
  function renderSheet() {
    const q = state.search.trim();
    document.querySelectorAll(".sheet th.c-term").forEach((th) => {
      th.classList.toggle("is-current", isCurrentTerm(th.dataset.term));
    });

    const rows = [];
    let lastGroup = null;
    for (const c of COURSES) {
      if (state.dept && c.dept !== state.dept) continue;
      if (q && !c.name.includes(q)) continue;
      if (state.onlyPlanned && !state.plan[c.id]) continue;

      const groupLabel = c.group ? `${c.dept}　${c.group}` : c.dept;
      if (groupLabel !== lastGroup) {
        rows.push(`<tr class="group-row"><td colspan="16">${esc(groupLabel)}</td></tr>`);
        lastGroup = groupLabel;
      }
      const credit = (k) => (c.kind === k ? fmtCredit(c.credits) : "");
      const mark = (p) => {
        const m = c.prog[p];
        return m ? `<span class="mark mark-${esc(m)}">${esc(m)}</span>` : "";
      };
      const planned = state.plan[c.id];
      const hl = state.prog && c.prog[state.prog] ? "is-hl" : "";
      const termCells = TERMS.map((t) => {
        const cls = ["term-cell"];
        if (c.terms.includes(t)) cls.push("is-std");
        if (planned === t) cls.push("is-plan");
        if (isCurrentTerm(t)) cls.push("is-current-col");
        return `<td class="${cls.join(" ")}" data-id="${c.id}" data-term="${t}" tabindex="0"` +
          ` title="${esc(c.name)}：${t}に履修予定にする">${planned === t ? "履" : ""}</td>`;
      }).join("");
      rows.push(
        `<tr class="${hl}">` +
        `<td class="name"><button class="name-btn" data-detail="${c.id}">${esc(c.name)}</button></td>` +
        `<td>${credit("必修")}</td><td>${credit("選必")}</td><td>${credit("選択") || credit("自由")}</td>` +
        `<td>${mark("PC")}</td><td>${mark("DE")}</td><td>${mark("HM")}</td><td>${mark("NS")}</td>` +
        termCells + `</tr>`
      );
    }
    sheetBody.innerHTML = rows.join("") ||
      `<tr><td colspan="16" class="empty">該当する科目がありません</td></tr>`;

    const all = Object.keys(state.plan).map((id) => byId.get(id)).filter(Boolean);
    const total = all.reduce((s, c) => s + c.credits, 0);
    $("sheetTotal").innerHTML = `予定 <strong>${all.length}</strong> 科目 / <strong>${fmtCredit(total)}</strong> 単位`;
  }

  sheetBody.addEventListener("click", (e) => {
    const nameBtn = e.target.closest("[data-detail]");
    if (nameBtn) {
      e.stopPropagation();
      openCourseDetail(byId.get(nameBtn.dataset.detail), nameBtn);
      return;
    }
    const cell = e.target.closest(".term-cell");
    if (!cell) return;
    const { id, term } = cell.dataset;
    setPlan(id, state.plan[id] === term ? null : term);
  });
  sheetBody.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("term-cell")) {
      e.preventDefault();
      e.target.click();
    }
  });

  // ---- 科目の詳細（科目名をタッチ → シラバスへ） ----
  function openCourseDetail(c, anchor) {
    const term = state.plan[c.id];
    const half = term ? term[1] : (c.terms[0] || "前")[1] || "前";
    const o = offeringFor(c, half) || offeringFor(c, half === "前" ? "後" : "前");
    const progs = Object.entries(c.prog).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ");
    const syl = o?.code
      ? `<a href="${SYLLABUS_URL(o.code, o.sem === "前期" ? "前" : "後")}" target="_blank" rel="noopener">シラバスを開く</a>`
      : `<button disabled>シラバス情報なし</button>`;
    const rm = term ? `<button class="danger" data-remove="${c.id}">予定を取り消す</button>` : "";
    showPopover(`
      <h3>${esc(c.name)}</h3>
      <p class="meta">${esc(c.kind)} ${fmtCredit(c.credits)}単位 ／ 標準：${c.terms.join("・") || "—"}${term ? ` ／ 予定：${term}` : ""}</p>
      ${progs ? `<p class="meta">プログラム指定 ${esc(progs)}</p>` : ""}
      ${o ? `<p class="meta">${esc(o.sem)} ${esc(o.day || "")}${o.period ? o.period + "限" : ""} ${esc(o.room || "")} ${esc(o.teacher || "")}（${esc(o.code)}）</p>` : ""}
      <div class="actions">${syl}${rm}</div>`, anchor);
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

  popover.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (rm) {
      setPlan(rm.dataset.remove, null);
      hidePopover();
    }
  });
  document.addEventListener("click", (e) => {
    if (!popover.hidden && !popover.contains(e.target)) hidePopover();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePopover(); });
  $("sheetScroll").addEventListener("scroll", hidePopover);

  // ---- 上部バー ----
  $("grade").value = String(state.grade);
  $("grade").addEventListener("change", (e) => { state.grade = Number(e.target.value); save(); render(); });
  $("search").addEventListener("input", (e) => { state.search = e.target.value; renderSheet(); });
  $("deptFilter").addEventListener("change", (e) => { state.dept = e.target.value; renderSheet(); });
  $("progHighlight").addEventListener("change", (e) => { state.prog = e.target.value; renderSheet(); });
  $("onlyPlanned").addEventListener("change", (e) => { state.onlyPlanned = e.target.checked; renderSheet(); });

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
    const planned = Object.entries(state.plan)
      .map(([id, term]) => ({ c: byId.get(id), term })).filter((x) => x.c);
    const sumTerms = (terms) => planned.filter((x) => terms.includes(x.term))
      .reduce((s, x) => s + x.c.credits, 0);
    const years = [
      ["1年", ["1前", "1後"]], ["2年", ["2前", "2後"]],
      ["3年前期", ["3前"]], ["3年後期", ["3後"]], ["4年", ["4前", "4後"]],
    ];
    const total = planned.reduce((s, x) => s + x.c.credits, 0);
    $("yearTable").innerHTML =
      years.map(([label, ts]) => `<tr><th>${label}</th><td>${fmtCredit(sumTerms(ts))} 単位</td></tr>`).join("") +
      `<tr class="total"><th>合計</th><td>${fmtCredit(total)} 単位</td></tr>`;

    const sumReq = (key) => planned.filter((x) => x.c.req.includes(key))
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
    renderSheet();
    if (!sidebar.hidden) renderSidebar();
  }
  render();
})();
