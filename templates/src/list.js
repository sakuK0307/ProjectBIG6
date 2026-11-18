// 履修リスト：科目リスト（学期プルダウン＋点数）と、右上ボタンで開く卒業判定サイドバー
// 予定・点数はブラウザ（localStorage）に保存し、別のタブで変わったら storage イベントで読み直す
(() => {
  // hidden の科目（先進コースと総合コースで重複する行の片方）は出さない・数えない
  const COURSES = (window.LIST_COURSES || []).filter((c) => !c.hidden);
  const YEAR = window.LIST_YEAR || 2026;
  const TERMS = ["1前", "1後", "2前", "2後", "3前", "3後", "4前", "4後"];
  const TERM_LABEL = (t) => `${t[0]}年${t[1]}期`;
  const PASS = 60; // 卒業判定Excelと同じく 60点以上で修得
  const STORAGE_KEY = "big6.listPlan.v2";
  const OLD_STORAGE_KEY = "big6.listPlan.v1";
  // 名城大学シラバス（Campusmate-J）の詳細ページ。
  // semekikn・crclumcd は前期・後期とも 1・12205 で開ける（卒業判定アプリ側で確認済み）
  const SYLLABUS_URL = (code) =>
    "https://gkmsyllabus.meijo-u.ac.jp/camweb/slbssbdr.do" +
    `?value(risyunen)=${YEAR}&value(semekikn)=1` +
    `&value(kougicd)=${encodeURIComponent(code)}&value(crclumcd)=12205`;

  const byId = new Map(COURSES.map((c) => [c.id, c]));

  // ---- 状態 ----
  // plan: { courseId: { term: "3前", score: 85 | null, code?: "642809" } }
  //   score が null なら「予定」（Excelの "60" 扱い）。code は選んだクラスの講義コード（時間割画面で使う予定）
  const state = { term: "3前", plan: {}, search: "", dept: "", prog: "", show: "" };
  function loadState() {
   state.plan = {};
   try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const old = saved ? null : JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || "null");
    const src = saved || old;
    if (src && typeof src === "object") {
      if (TERMS.includes(src.term)) state.term = src.term;
      else if (src.grade) state.term = `${src.grade}前`; // 学年だけ保存していた旧形式
      for (const [id, v] of Object.entries(src.plan || {})) {
        if (!byId.has(id)) continue;
        if (typeof v === "string") state.plan[id] = { term: v, score: null }; // v1 からの移行
        else if (v && TERMS.includes(v.term)) {
          state.plan[id] = { term: v.term, score: v.score ?? null };
          if (v.code) state.plan[id].code = v.code;
        }
      }
    }
   } catch { /* 保存領域が使えなくても動く */ }
  }
  loadState();
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ term: state.term, plan: state.plan }));
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

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmtCredit = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  for (const d of new Set(COURSES.map((c) => c.dept))) {
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
    for (const t of c.terms) {
      const now = t === state.term ? " is-now" : "";
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
    if (state.show === "grade" && !c.terms.includes(state.term)) return false;
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
      // 学期を変えたらクラスの選択（code）は選び直し
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
    const p = state.plan[c.id];
    const term = p ? p.term : c.terms[0];
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
      <p class="meta">${esc(c.kind)} ${fmtCredit(c.credits)}単位 ／ 標準：${c.terms.map(TERM_LABEL).join("・") || "—"}${p ? ` ／ 予定：${TERM_LABEL(p.term)}` : ""}</p>
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
  $("search").addEventListener("input", (e) => { state.search = e.target.value; renderList(); });
  $("deptFilter").addEventListener("change", (e) => { state.dept = e.target.value; renderList(); });
  $("progFilter").addEventListener("change", (e) => { state.prog = e.target.value; renderList(); });
  $("showFilter").addEventListener("change", (e) => { state.show = e.target.value; renderList(); });

  // 未実装のボタン（表示B・C、送信、読込）はトーストで知らせる
  const toast = $("toast");
  let toastTimer;
  document.querySelectorAll("[data-stub]").forEach((b) => b.addEventListener("click", () => {
    toast.textContent = `「${b.dataset.stub}」はまだ実装されていません`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
  }));

  // ---- 卒業判定サイドバー ----
  // 必要単位数は curriculum.json の requirements（プログラムごとに下の9項目の順）
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
  const REQUIREMENTS = window.LIST_REQUIREMENTS || {};
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

    const sumReq = (key) => counted.filter((x) => x.c.req.includes(key))
      .reduce((s, x) => s + x.c.credits, 0);
    $("progList").innerHTML = PROGRAMS.map(([p, name]) => {
      const rows = REQS.map(([label, key], i) => {
        const need = REQUIREMENTS[p]?.[i] ?? 0;
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
    render();
  });

  function render() {
    renderList();
    if (!sidebar.hidden) renderSidebar();
  }
  render();
})();
