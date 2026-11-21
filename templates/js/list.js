// ============================================================================
// list.js ― 履修リスト画面（templates/list.html）の画面の動き
//
// できること
//   ・科目ごとに「何年何期に履修するか」「何点だったか」を入れる（再履修もできる）
//   ・入れた内容から、単位の合計と、進級・研究ゼミ・卒研着手・卒業・DS・AI の判定をその場で出す
//   ・科目名を押すと、開講クラスとシラバスへのリンクを出す
//   ・成績通知書・履修登録の PDF を読み取って取り込む
//
// ファイルの分け方（ES モジュール。list.html で <script type="module"> として読む）
//   list-api.js   … サーバーとのやり取り（URL・fetch を知っているのはここだけ）
//   list-rules.js … 決まりごとと判定の計算（画面に触らない）
//   list.js       … 画面の表示と操作（このファイル）
//   pdf-import.js … PDF の読み取り（普通の <script>。window.PdfImport を使う）
//
// このファイルの並び
//   1. サーバーからデータを受け取る          → DATA（科目）・SAVED（保存済みの計画）
//   2. 画面が覚えている値（state）と、判定の材料（context）・保存
//   3. 科目リストの表示と入力（renderList / rowHtml / change イベント）
//   4. 科目の詳細（ポップオーバー）
//   5. 上部バー・絞り込み・トースト
//   6. 卒業判定サイドバー（計算は list-rules.js、ここは HTML を作るだけ）
//   7. PDF の取り込み
//   8. 最初の描画 render()
//
// 画面全体（HTML・CSS・JS・モック）の解説は docs/ListPage.md にある
// ============================================================================
import { ListApi } from "./list-api.js";
import {
  TERMS,
  TERM_LABEL,
  ENTRANCE_YEARS,
  COURSE_TYPES,
  termIndex,
  sortAttempts,
  cleanScore,
  fmtCredit,
  inCourseType,
  termsOf as termsOfIn,
  notCountedFor as notCountedForIn,
  readSavedPlan,
  attemptStatus,
  summaryOf,
  attemptWarning as attemptWarningIn,
  makeContext,
  countedCourses,
  evaluate,
  judgments,
} from "./list-rules.js";

// モジュールは自分専用の範囲を持つので、中の変数がほかの JS とぶつからない
//（以前のように全体を (() => { … })() で囲む必要がない）

// ---- 1. サーバーから受け取る（科目データと、保存してある履修計画） ----
// DATA ：科目データ { timetableYear, rules, courses }（GET /api/courses）
// SAVED：保存してある履修計画 { term, entrance, courseType, plan }（GET /api/plan）
// try の中で入れるので const ではなく let（try の中の const は外から使えないため）
let DATA, SAVED;
try {
  // 2 つを同時に頼み、両方届くまで待つ（モジュールの一番外側でも await が使える）
  [DATA, SAVED] = await Promise.all([ListApi.getCourses(), ListApi.getPlan()]);
} catch (e) {
  // 受け取れなかったら一覧の場所に知らせを出して止める（< > & を消すのは、エラー文が HTML として動かないようにするため）
  document.getElementById("sheetBody").innerHTML =
    `<p class="empty">サーバーからデータを受け取れませんでした（${String(e.message).replace(/[<>&]/g, "")}）。Flask を起動して開いてください。</p>`;
  // throw でこのファイルの残りを実行しない（モジュールの一番外側では return が使えないため）
  throw e;
}

// 科目の一覧。学生便覧にあって卒業判定 Excel に無い自由科目（数学基礎演習など）も、
// サーバーのデータ（scripts/data/excel_extra.csv から作る）に入っている
const ALL_COURSES = DATA.courses || [];
// 時間割表の年度（シラバスの URL と「○年度の時間割表」の表示に使う）
const TIMETABLE_YEAR = DATA.timetableYear || 2026;
// 名城大学シラバス（Campusmate-J）の詳細ページ。semekikn・crclumcd は前期・後期とも 1・12205 で開ける
const SYLLABUS_URL = (code) =>
  "https://gkmsyllabus.meijo-u.ac.jp/camweb/slbssbdr.do" +
  `?value(risyunen)=${TIMETABLE_YEAR}&value(semekikn)=1` +
  `&value(kougicd)=${encodeURIComponent(code)}&value(crclumcd)=12205`;
// 科目 ID → 科目。両コースの全科目を入れる（コースを切り替えても予定・点数を残すため）
const byId = new Map(ALL_COURSES.map((c) => [c.id, c]));
// 判定の決まりごと：必要単位数（rules.requirements。卒業判定 Excel から）と、
// 入学年度で数えない科目・進級などの条件（scripts/data/rules.json に手で書いたもの）
const RULES = DATA.rules;

// ---- 2. 状態 ----
// 画面が覚えている値。term・entrance・courseType・plan はサーバーに保存し、
// search・dept・prog・show（検索・絞り込み）は保存しない（開き直したら全部表示に戻る）
// plan: { courseId: { attempts: [{ term: "1前", score: 45 }, { term: "2前", score: null }], code?: "642809" } }
//   attempts は履修した回（再履修を含む）。学期順に並べる。score が null の回は「予定」
//   code は選んだクラスの講義コード（時間割画面で使う予定）
const state = {
  term: "3前",
  entrance: 2025,
  courseType: "advanced",
  plan: {},
  search: "",
  dept: "",
  prog: "",
  show: "",
};
// 保存済みの計画のうち、使える値だけを state に入れる（ここに書いた値は初期値）
Object.assign(state, readSavedPlan(SAVED, new Set(byId.keys())));

// 今の state で判定するための材料（今のコースの科目・数えるかどうかの判定など）。呼ぶたびに今の state で作る
const context = () =>
  makeContext({
    allCourses: ALL_COURSES,
    byId,
    plan: state.plan,
    courseType: state.courseType,
    entrance: state.entrance,
    rules: RULES,
  });
// 今のコースで表示・集計する科目
const courses = () => context().courses;
// 科目の標準の学期（入学年度で違う科目があるので、今の入学年度で決める）
const termsOf = (c) => termsOfIn(c, state.entrance);
// 入学年度の決まりで卒業要件に数えない科目か（rules.json の notCounted）
const notCountedFor = (c, entrance, type) => notCountedForIn(c, entrance, type, RULES);
// その回の学期についての注意（開講していない学期・上の学年の授業）
const attemptWarning = (c, a) => attemptWarningIn(c, a, { timetableYear: TIMETABLE_YEAR, entrance: state.entrance });

// 保存。学期・点数・コースなどを変えたら、毎回これを呼ぶ（PUT /api/plan）
// 変わった 1 科目だけでなく丸ごと送るのは、作りが簡単で、サーバーと画面が食い違いにくいから
// 実際に送るのは list-api.js（送っている途中に次が来たら、最新のものだけ送る）
const save = () => {
  ListApi.savePlan({ term: state.term, entrance: state.entrance, courseType: state.courseType, plan: state.plan });
};

// ---- 画面の部品 ----
// $("id") で画面の要素を取り出す短い書き方
const $ = (id) => document.getElementById(id);
// よく使う要素は最初に取り出しておく（app：画面全体、list：科目の一覧、popover：科目の詳細の窓）
const app = $("app");
const list = $("sheetBody");
const popover = $("popover");

// 文字を HTML に入れても安全な形にする（& < > " ' を記号の表し方に置き換える）
// 科目名などに < が入っていても、画面が崩れたり、意図しない HTML として動いたりしないようにするため
// s ?? "" は、null・undefined を空文字にするため
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );

// 「部門」の絞り込みの選択肢を、科目データにある部門から作る（Set で重なりを消す）
// 手で書かないのは、科目データが変わっても選択肢を直さなくて済むようにするため
for (const d of new Set(ALL_COURSES.map((c) => c.dept))) {
  const o = document.createElement("option");
  o.value = d;
  o.textContent = d;
  $("deptFilter").appendChild(o);
}

// ---- 3. 科目リスト ----
// 学期のプルダウンの中身（未登録＋1年前期〜4年後期）。どの行も同じなので1回だけ作って使い回す
const termOptions =
  `<option value="">未登録</option>` + TERMS.map((t) => `<option value="${t}">${TERM_LABEL(t)}</option>`).join("");

// 科目名の下に並ぶ小さなタグの HTML を作る
function tagsHtml(c) {
  // 1つ目：区分と単位数（例「選必 1単位」）
  const tags = [`<span class="tag kind-${esc(c.kind)}">${esc(c.kind)} ${fmtCredit(c.credits)}単位</span>`];
  // プログラムで絞り込んでいるときは、そのプログラムの印だけを出す（ほかの印があると見づらいので）
  const progs = state.prog ? [state.prog] : ["PC", "DE", "HM", "NS"];
  for (const p of progs) {
    const m = c.prog[p];
    // ◎・※・○ の印を出す。「必」は区分のタグで分かるので出さない
    if (m && m !== "必") tags.push(`<span class="tag p-${esc(m)}">${p}${esc(m)}</span>`);
  }
  // 標準の学期。今の学期（上部バー）と同じなら is-now を付けて目立たせる
  for (const t of termsOf(c)) {
    const now = t === state.term ? " is-now" : "";
    tags.push(`<span class="tag std${now}">標準 ${TERM_LABEL(t)}</span>`);
  }
  // 自由科目は卒業要件に数えないことを知らせる
  if (c.kind === "自由") tags.push(`<span class="tag free">卒業要件に数えない（自由科目）</span>`);
  // 「夏期集中」などの注記
  if (c.note) tags.push(`<span class="tag">${esc(c.note)}</span>`);
  // 入学年度の決まりで数えない科目（2023 年度入学・先進の「情報技術の応用と職業」）
  if (notCountedFor(c, state.entrance, state.courseType)) {
    tags.push(`<span class="tag not-counted">卒業要件に数えない（${state.entrance}年度入学）</span>`);
  }
  return tags.join("");
}

// 1回分の入力欄（学期のプルダウン・点数・状態）の HTML を作る
// c：科目、a：その回（未登録なら null）、i：何回目か（0 始まり）、total：回の数
function attemptHtml(c, a, i, total) {
  const st = a ? attemptStatus(a) : { key: "", label: "" };
  // 2回以上あるときだけ「初回」「再履修」「再履修2」…の印を付ける（1回だけなら印はいらない）
  const no = total > 1 ? `<span class="attempt-no">${i === 0 ? "初回" : `再履修${total > 2 ? i : ""}`}</span>` : "";
  const warn = attemptWarning(c, a);
  // data-i：何回目の欄か。change イベントで、どの回を変えたかを知るために使う
  // aria-label：画面の読み上げソフトに「○○の履修学期（1回目）」と伝えるため
  // 学期を選ぶまで（a が null）は点数を入れられないように disabled にする
  return `<div class="attempt ${st.key}" data-i="${i}">
      ${no}
      <select class="term-sel" data-i="${i}" aria-label="${esc(c.name)}の履修学期（${i + 1}回目）">${termOptions}</select>
      <input class="score" type="number" min="0" max="100" step="1" inputmode="numeric" data-i="${i}"
        placeholder="点数" aria-label="${esc(c.name)}の点数（${i + 1}回目）" ${a ? "" : "disabled"}
        value="${a && a.score != null ? a.score : ""}">
      <span class="status">${st.label}</span>
    </div>${warn ? `<p class="attempt-warn">⚠ ${esc(warn)}</p>` : ""}`;
}

// 科目1行の HTML を作る（科目名とタグ、回ごとの入力欄、再履修ボタン）
function rowHtml(c) {
  const s = summaryOf(state.plan[c.id]);
  // 1回も登録していない科目にも、空の入力欄を1つ出すため [null] にする
  const attempts = s.attempts.length ? s.attempts : [null];
  // 科目名はボタン。押すと科目の詳細を出す（data-detail に科目 ID を入れておく）
  // 不可で終わっている科目だけ、再履修を追加するボタンを出す
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
// HTML の文字列ではプルダウンの「選んである値」を入れにくいので、作ったあとで value を入れる
function fillSelects(row) {
  const attempts = state.plan[row.dataset.id]?.attempts || [];
  row.querySelectorAll(".term-sel").forEach((sel) => {
    sel.value = attempts[Number(sel.dataset.i)]?.term || "";
  });
}

// 科目 c を、今の検索・絞り込みで表示するか
function visible(c) {
  if (state.dept && c.dept !== state.dept) return false;
  if (state.search.trim() && !c.name.includes(state.search.trim())) return false;
  if (state.prog && !c.prog[state.prog]) return false;
  if (state.show === "planned" && !state.plan[c.id]) return false;
  if (state.show === "unplanned" && state.plan[c.id]) return false;
  // 「選択学期の標準科目」：標準の学期が、上部バーの学期と同じ科目だけ
  if (state.show === "grade" && !termsOf(c).includes(state.term)) return false;
  return true;
}

// 科目の一覧をまるごと作り直す（コース・入学年度・絞り込みを変えたとき）
function renderList() {
  const html = [];
  // 1つ前の行の部門・科目群。変わったところに見出しを入れるために覚えておく
  let lastGroup = null;
  for (const c of courses()) {
    if (!visible(c)) continue;
    // 見出しの文字（例「専門教育部門　理工学基礎科目」）。科目群がなければ部門だけ
    const group = c.group ? `${c.dept}　${c.group}` : c.dept;
    if (group !== lastGroup) {
      // 見出し。CSS の position: sticky で、スクロールしても一覧の上に残る
      html.push(`<div class="group-head">${esc(group)}</div>`);
      lastGroup = group;
    }
    html.push(rowHtml(c));
  }
  // 1つずつ画面に足すより、文字列をつなげて1回で入れるほうが速い
  list.innerHTML = html.join("") || `<p class="empty">該当する科目がありません</p>`;
  // 入れたあとで、各行のプルダウンに選んである学期を入れる
  list.querySelectorAll(".course").forEach(fillSelects);
  renderTotal();
}

// 一覧の上の「修得 ○ ＋ 予定 ○ 単位」
function renderTotal() {
  const { isCounted } = context();
  // 登録した科目のうち、今のコースで卒業要件に数えるもの
  const entries = Object.entries(state.plan)
    .map(([id, p]) => ({ c: byId.get(id), p }))
    .filter((x) => isCounted(x.c));
  // 条件 f に合う科目の単位数を足す
  const sum = (f) => entries.filter(f).reduce((s, x) => s + x.c.credits, 0);
  const passed = sum((x) => summaryOf(x.p).earned);
  const planned = sum((x) => {
    const s = summaryOf(x.p);
    return !s.earned && s.planned;
  });
  $("sheetTotal").innerHTML =
    `修得 <strong>${fmtCredit(passed)}</strong> ＋ 予定 <strong>${fmtCredit(planned)}</strong> 単位`;
}

// 1科目分だけ描き直す（全体は描き直さない）。入力中の欄にフォーカスを戻す
// 入力したときに使う。全部ではなく、その1行だけを作り直す
// 理由：140 行以上を毎回作り直すと遅く、入力中の欄からカーソルが外れてしまうから
function updateRow(id) {
  const row = list.querySelector(`.course[data-id="${id}"]`);
  if (row) {
    const f = document.activeElement;
    // 今カーソルがこの行の欄にあれば、どの欄（クラス名と何回目か）だったか覚えておく
    const focus = row.contains(f) && f.dataset.i != null ? { cls: f.classList[0], i: f.dataset.i } : null;
    const tmp = document.createElement("div");
    tmp.innerHTML = rowHtml(byId.get(id));
    const fresh = tmp.firstElementChild;
    // 古い行を新しい行に入れ替える
    row.replaceWith(fresh);
    fillSelects(fresh);
    // 覚えておいた欄にカーソルを戻す
    if (focus) fresh.querySelector(`.${focus.cls}[data-i="${focus.i}"]`)?.focus();
  }
  renderTotal();
  // サイドバーが開いているときだけ判定を計算し直す（閉じているときは計算しないので軽い）
  if (!sidebar.hidden) renderSidebar();
}

// 一覧の中のプルダウン・点数の変更を、一覧全体でまとめて受け取る（イベントの委任）
// 1つずつ登録しないのは、行を作り直すたびに登録し直さなくて済むようにするため
list.addEventListener("change", (e) => {
  // 変更された欄が入っている科目の行。data-i が無い欄（関係ない要素）なら何もしない
  const row = e.target.closest(".course");
  if (!row || e.target.dataset.i == null) return;
  const id = row.dataset.id;
  const i = Number(e.target.dataset.i);
  const p = state.plan[id];
  if (e.target.classList.contains("term-sel")) {
    const term = e.target.value;
    // 学期のプルダウンを変えたとき
    if (!term) {
      // 「未登録」にした回を消す。全部なくなれば科目ごと消す
      // 「未登録」にした → その回を消す。回が 0 になったら科目ごと消す
      if (p) p.attempts.splice(i, 1);
      if (!p || !p.attempts.length) delete state.plan[id];
      // 初めて学期を選んだ → 予定の回を1つ作る
    } else if (!p) {
      state.plan[id] = { attempts: [{ term, score: null }] };
      // 同じ科目で、ほかの回と同じ学期を選んだ → 同じ学期に2回は取れないので元に戻して知らせる
    } else if (p.attempts.some((a, j) => j !== i && a.term === term)) {
      // 同じ科目で同じ学期の回は作らない
      e.target.value = p.attempts[i]?.term || "";
      showToast(`${TERM_LABEL(term)}の回はすでにあります`);
      return;
    } else {
      // その回の学期を変える（点数はそのまま）。学期順が変わるかもしれないので並べ直す
      p.attempts[i] = { term, score: p.attempts[i]?.score ?? null };
      sortAttempts(p.attempts);
      // 学期が変われば開講しているクラスも変わるので、選んでいたクラスは選び直しにする
      delete p.code; // 学期を変えたらクラスの選択は選び直し
    }
    // 点数の欄を変えたとき
  } else if (e.target.classList.contains("score")) {
    if (!p?.attempts[i]) return;
    // 0〜100 の整数にそろえて入れる。空にしたら null（予定に戻る）
    p.attempts[i].score = cleanScore(e.target.value.trim());
  }
  save();
  // 絞り込み中に条件から外れる変更なら全体を描き直す
  // 「登録済みのみ」「未登録のみ」で絞っていると、今の変更で表示する・しないが変わるので全体を作り直す
  // それ以外は、その1行だけ作り直せば足りる
  if (state.show === "planned" || state.show === "unplanned") renderList();
  else updateRow(id);
});
// 点数の欄で Enter を押したら欄から抜ける（blur）。抜けたときに change が起きて保存される
list.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("score")) e.target.blur();
});
// 一覧の中のボタン（再履修・科目名）のクリックも、一覧全体でまとめて受け取る
list.addEventListener("click", (e) => {
  const retake = e.target.closest("[data-retake]");
  if (retake) {
    // 再履修：最後の回の次の学期を初期値にして、1回分足す
    const id = retake.dataset.retake;
    const attempts = state.plan[id].attempts;
    // 新しい回の学期の初期値は、最後の回の次の学期（4年後期より後にはしない）
    const next = TERMS[Math.min(termIndex(attempts[attempts.length - 1].term) + 1, TERMS.length - 1)];
    attempts.push({ term: next, score: null });
    sortAttempts(attempts);
    save();
    updateRow(id);
    // 足した回のプルダウンにカーソルを移す（すぐ学期を選び直せるように）
    list.querySelector(`.course[data-id="${id}"] .term-sel[data-i="${attempts.length - 1}"]`)?.focus();
    return;
  }
  const nameBtn = e.target.closest("[data-detail]");
  if (nameBtn) {
    // このクリックが下の「窓の外を押したら閉じる」に届かないようにする（開いた直後に閉じてしまうため）
    e.stopPropagation();
    openCourseDetail(byId.get(nameBtn.dataset.detail), nameBtn);
  }
});

// 開講枠1つを「A 水3・4限 隔週A N-324 担当」のような1行にする
// o：開講クラス1つ。押すとシラバスが新しいタブで開くリンクにする
function offerLine(o) {
  // 2コマ続きの授業は「水3・4限」のようにまとめる。コマが無ければ曜日・時限（無ければ「時限未定」）
  const slots = (o.slots || []).length
    ? `${o.slots[0].day}${o.slots.map((x) => x.period).join("・")}限`
    : `${o.day || ""}${o.period ? o.period + "限" : "（時限未定）"}`;
  const tags = [
    // 再履修クラスか、A・B などのクラス名。隔週の授業なら「隔週A」も付ける
    o.retake ? "再履修" : o.cls ? `${o.cls}クラス` : "",
    o.biweekly ? `隔週${o.biweekly}` : "",
  ]
    .filter(Boolean)
    .join("・");
  // target="_blank"：新しいタブで開く。rel="noopener"：開いたページからこのページを操作されないようにする
  return `<li><a href="${SYLLABUS_URL(o.code)}" target="_blank" rel="noopener">
      <strong>${esc(slots)}</strong> ${esc(o.room || "")}
      <small>${tags ? esc(tags) + " ／ " : ""}${esc(o.teacher || "")}（${esc(o.code)}）${o.note ? "<br>" + esc(o.note) : ""}</small>
    </a></li>`;
}

// ---- 4. 科目の詳細（科目名をタッチ → 開講クラスとシラバス） ----
// c：科目、anchor：押された科目名のボタン（窓をその近くに出すため）
function openCourseDetail(c, anchor) {
  const s = summaryOf(state.plan[c.id]);
  // いちばん新しい回の学期（登録していなければ標準の学期）。その学期のクラスを先に出すため
  const term = s.attempts.length ? s.attempts[s.attempts.length - 1].term : c.terms[0];
  // これまでの履修（例「1年前期 45点、2年後期 予定」）
  const history = s.attempts
    .map((a) => `${TERM_LABEL(a.term)} ${a.score == null ? "予定" : `${a.score}点`}`)
    .join("、");
  // プログラム指定（例「DE:◎ HM:○」）
  const progs = Object.entries(c.prog)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
  // 開講クラスを 前期・後期・通年 に分ける
  const bySem = { 前期: [], 後期: [], 通年: [] };
  for (const o of c.offers || []) (bySem[o.sem] ||= []).push(o);
  // 履修予定（なければ標準）の学期を先に出す
  // 見たい学期のクラスを先頭にする（後期に履修するなら後期のクラスを先に）
  const first = term && term[1] === "後" ? "後期" : "前期";
  const order = [first, first === "前期" ? "後期" : "前期", "通年"];
  const sections = order
    .filter((sem) => bySem[sem]?.length)
    .map(
      (sem) =>
        `<p class="meta sem">${sem}の開講クラス（タッチでシラバス）</p><ul class="offers">${bySem[sem].map(offerLine).join("")}</ul>`,
    )
    .join("");
  showPopover(
    `
    <h3>${esc(c.name)}</h3>
    <p class="meta">${esc(c.kind)} ${fmtCredit(c.credits)}単位 ／ 標準：${c.terms.map(TERM_LABEL).join("・") || "—"}</p>
    ${history ? `<p class="meta">履修：${esc(history)}</p>` : ""}
    ${progs ? `<p class="meta">プログラム指定 ${esc(progs)}</p>` : ""}
    ${sections || `<p class="empty">${TIMETABLE_YEAR}年度の時間割表に開講情報がありません</p>`}`,
    anchor,
  );
}

// 科目の詳細の窓を、押したボタンのすぐ下に出す。画面の端からはみ出さないように位置を調整する
function showPopover(html, anchor) {
  popover.innerHTML = html;
  popover.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = popover.offsetWidth,
    h = popover.offsetHeight;
  // 右にはみ出すなら左へずらす（端から 8px あける）
  const left = Math.min(r.left, window.innerWidth - w - 8);
  let top = r.bottom + 4;
  // 下に入りきらなければ、ボタンの上に出す
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
  popover.style.left = `${Math.max(8, left)}px`;
  popover.style.top = `${top}px`;
}
// 窓を閉じる。次の3つのとき：窓の外を押した、Esc を押した、一覧をスクロールした
// スクロールで閉じるのは、窓がボタンから離れて、どの科目の窓か分からなくなるため
const hidePopover = () => {
  popover.hidden = true;
};
document.addEventListener("click", (e) => {
  if (!popover.hidden && !popover.contains(e.target)) hidePopover();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hidePopover();
});
$("sheetScroll").addEventListener("scroll", hidePopover);

// ---- 5. 上部バー・絞り込み ----
// 上部バーの学年・学期
// 上部バーの「今の学年・学期」。変えたら保存して、全体を描き直す（標準科目の強調などが変わるため）
const termSel = $("headerTerm");
termSel.value = state.term;
termSel.addEventListener("change", () => {
  state.term = termSel.value;
  save();
  render();
});
// 入学年度。変えると標準の学期や数えない科目が変わるので、全体を描き直す
const entranceSel = $("entranceYear");
entranceSel.value = String(state.entrance);
entranceSel.addEventListener("change", () => {
  state.entrance = Number(entranceSel.value);
  save();
  hidePopover();
  render();
});
// コース（先進・総合）。表示する科目と必要単位数が変わるので、全体を描き直す
const courseSel = $("courseType");
courseSel.value = state.courseType;
courseSel.addEventListener("change", () => {
  state.courseType = courseSel.value;
  save();
  hidePopover();
  render();
});
// 検索・絞り込み。表示が変わるだけなので保存しない（input は1文字打つたび、change は選んだとき）
$("search").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderList();
});
$("deptFilter").addEventListener("change", (e) => {
  state.dept = e.target.value;
  renderList();
});
$("progFilter").addEventListener("change", (e) => {
  state.prog = e.target.value;
  renderList();
});
$("showFilter").addEventListener("change", (e) => {
  state.show = e.target.value;
  renderList();
});

// 未実装のボタン（表示B・C、送信、読込）はトーストで知らせる
// トースト：画面の下に少しの間だけ出る知らせ
const toast = $("toast");
let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  // 1.8 秒で消す。続けて出したときは、前のタイマーを消してから数え直す（すぐ消えないように）
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}
// まだ作っていないボタン（HTML で data-stub を付けたもの）を押したら知らせる
document.querySelectorAll("[data-stub]").forEach((b) =>
  b.addEventListener("click", () => {
    showToast(`「${b.dataset.stub}」はまだ実装されていません`);
  }),
);

// ---- 6. 卒業判定サイドバー（計算は list-rules.js の evaluate・judgments） ----
const sidebar = $("sidebar");
const sidebarToggle = $("sidebarToggle");
// サイドバーで開いているプログラム。描き直しても開いたままにするため覚えておく（最初は DE だけ開く）
const openProgs = new Set(["DE"]);

// 卒業判定サイドバーを作る：① 学年ごとの単位 ② プログラムごとの9項目 ③ 進級・卒業などの判定
function renderSidebar() {
  $("sidebarCourse").textContent = `${state.entrance}年度入学・${COURSE_TYPES[state.courseType]}`;
  // 判定の材料と、判定に数える科目（修得済み・予定のもの）
  const ctx = context();
  const counted = countedCourses(ctx);
  // 指定した学期に数える（countTerm がその学期の）科目の単位数の合計
  const sumTerms = (terms) =>
    counted.filter((x) => terms.includes(summaryOf(x.p).countTerm)).reduce((s, x) => s + x.c.credits, 0);
  // 学年ごとに 前期・後期 の2行。左の学年セルに年間の小計を出す
  const total = counted.reduce((s, x) => s + x.c.credits, 0);
  // ① 学年ごとの表。学年のセルは2行分（rowspan=2）にして、年間の小計を出す
  let rows = `<tr><th>学年</th><th>学期</th><th class="num">単位</th></tr>`;
  for (const y of ["1", "2", "3", "4"]) {
    ["前", "後"].forEach((h, i) => {
      const t = y + h;
      const cur = t === state.term ? ' class="is-current"' : "";
      const yearCell =
        i === 0
          ? `<th rowspan="2" class="year">${y}年<small>${fmtCredit(sumTerms([y + "前", y + "後"]))} 単位</small></th>`
          : "";
      rows += `<tr${cur}>${yearCell}<td class="half">${h}期</td><td>${fmtCredit(sumTerms([t]))} 単位</td></tr>`;
    });
  }
  rows += `<tr class="total"><th colspan="2">合計</th><td>${fmtCredit(total)} 単位</td></tr>`;
  $("yearTable").innerHTML = rows;

  // ② ③ 全学期の分で判定する（null は「学期で区切らない」）
  const all = evaluate(ctx, null);
  $("judgeList").innerHTML = judgmentsHtml(ctx, all);
  // ② プログラムごとの9項目。<details> は押すと開け閉めできる HTML の部品
  // 足りない項目には short を付けて赤くする。progress はプログレスバー
  $("progList").innerHTML = all.programs
    .map(
      ({ p, name, rows, done, needed }) => `
    <details class="prog" data-prog="${p}" ${openProgs.has(p) ? "open" : ""}>
      <summary>${p}<small class="prog-name">${name}</small>
        <span class="badge ${done ? "ok" : ""}">${done ? "修了" : `残り最低${fmtCredit(needed)}科目`}</span></summary>
      <ul class="req-list">${rows
        .map(
          (r) => `
        <li class="${r.got < r.need ? "short" : ""}"><span>${r.label}</span>
          <span class="val">${fmtCredit(r.got)} / ${r.need}</span>
          <progress value="${Math.min(r.got, r.need)}" max="${r.need}"></progress></li>`,
        )
        .join("")}
      </ul></details>`,
    )
    .join("");
}

// 判定（list-rules.js の judgments）の結果を、サイドバーの HTML にする
function judgmentsHtml(ctx, all) {
  const items = judgments(ctx, all);
  // metrics 1つ分のプログレスバーの HTML
  const bar = (m) => {
    // 「以下なら充足」の値は、need を超えた分だけ短くする（例：残り20科目なら 10/20）
    const ok = m.less ? m.got <= m.need : m.got >= m.need;
    // バーの長さ（0〜1）。少ないほど良い値は、need 以下なら満タン、超えたら need/got に縮める
    const value = m.less ? (m.got <= m.need ? 1 : m.need / m.got) : Math.min(m.got / m.need, 1);
    return `<li class="${ok ? "" : "short"}"><span>${m.label}</span>
        <span class="val">${fmtCredit(m.got)}${m.less ? `（${m.need}以内）` : ` / ${m.need}`} ${m.unit}</span>
        <progress value="${value}" max="1"></progress></li>`;
  };
  return items
    .map(
      (x) => `
    <li class="${x.ok ? "ok" : "ng"}">
      <div class="judge-top">
        <span class="judge-title">${x.title}</span>
        <span class="badge ${x.ok ? "ok" : ""}">${x.ok ? (x.optional ? "認定" : "可") : x.optional ? "未認定" : "未充足"}</span>
      </div>
      <ul class="req-list">${x.metrics.map(bar).join("")}</ul>
      <small>${esc(x.note)}</small>
    </li>`,
    )
    .join("");
}

// プログラムの開け閉めを覚えておく（描き直しても開いたままにするため）
// toggle は親に伝わらないイベントなので、最後の true（捕まえる段階で受け取る）を付けている
$("progList").addEventListener(
  "toggle",
  (e) => {
    const d = e.target.closest("details");
    if (d) d.open ? openProgs.add(d.dataset.prog) : openProgs.delete(d.dataset.prog);
  },
  true,
);

// サイドバーを開く・閉じる。開いたときに判定を作る（閉じている間は計算しない）
const setSidebar = (open) => {
  sidebar.hidden = !open;
  // 画面全体に has-sidebar を付けると、CSS でサイドバーの分だけ一覧が狭くなる
  app.classList.toggle("has-sidebar", open);
  // 読み上げソフトに「開いている／閉じている」を伝える
  sidebarToggle.setAttribute("aria-expanded", String(open));
  if (open) renderSidebar();
};
// stopPropagation：このクリックで、科目の詳細の窓を閉じる処理が動かないようにする
sidebarToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  setSidebar(sidebar.hidden);
});
$("sidebarClose").addEventListener("click", () => setSidebar(false));

// 保存に失敗したら知らせる（list-api.js が送る）
// list-api.js が保存に失敗したときに送ってくる合図を受け取って、トーストで知らせる
window.addEventListener("listapi:save-error", (e) => {
  showToast(`保存できませんでした：${e.detail?.message || ""}`);
});

// ---- 7. PDF の読み取り（成績通知書・履修登録科目確認通知書） ----
// 読み取りは src/pdf-import.js。PDF はブラウザの中だけで読み、どこにも送らない
// 読み取り結果を出す窓（<dialog>）と、その中身（<form method="dialog">）
const importDialog = $("importDialog");
const importBody = $("importBody");
// 読み取った結果（取り込むか決めるまで覚えておく）
let importResult = null;

// 「PDF読込」ボタン → 隠してあるファイル選択欄を押したことにする（見た目をボタンにそろえるため）
$("pdfImportBtn").addEventListener("click", () => $("pdfInput").click());
$("pdfInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // 同じファイルをもう一度選べるように
  if (!file) return;
  importBody.innerHTML = `<h2 id="importTitle">PDF を読み取っています…</h2><p class="import-meta">${esc(file.name)}</p>`;
  // 窓を開く（showModal：後ろの画面を操作できないようにして開く）
  importDialog.showModal();
  try {
    // 読み取りは pdf-import.js。PDF の科目名をこのアプリの科目と照らし合わせるために、科目の一覧を渡す
    importResult = await window.PdfImport.read(file, {
      courses: ALL_COURSES,
      inCourseType,
      fallbackType: state.courseType,
    });
    renderImport();
  } catch (err) {
    importBody.innerHTML = `<h2 id="importTitle">読み取れませんでした</h2>
      <p class="import-meta">${esc(err.message || String(err))}</p>
      <div class="import-actions"><button value="cancel">閉じる</button></div>`;
  }
});

// 読み取り結果の表と、「取り込む」「やめる」ボタンを窓の中に作る
function renderImport() {
  const r = importResult;
  // 成績通知書でも履修登録の通知書でもない PDF、または1行も読めなかったとき
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
  ]
    .filter(Boolean)
    .join("・");
  // PDF の入学年度・コースが今の設定と違うか（違えば「PDF に合わせる」チェックを出す）
  const changeMeta =
    (r.entrance && r.entrance !== state.entrance) || (r.courseType && r.courseType !== state.courseType);
  // 取り込める行の数（problem がある行は、科目が見つからないなど取り込めない）
  const ok = r.rows.filter((x) => !x.problem).length;
  // 行ごとのチェック。取り込めない行はチェックできない（disabled）
  importBody.innerHTML = `
    <h2 id="importTitle">${esc(r.title)}の読み取り結果</h2>
    <p class="import-meta">${esc(meta)} ／ ${r.rows.length}行のうち ${ok}行を取り込めます</p>
    <p class="import-meta">${
      r.kind === "grades"
        ? "点数のある科目は、その学期の点数として入れます（同じ学期の回があれば上書き）。「履修中」は予定として入れます。"
        : "登録した科目を、その学期の予定として入れます（点数が入っている回はそのまま）。"
    }</p>
    ${
      changeMeta
        ? `<label class="import-check"><input type="checkbox" id="importMeta" checked>
      入学年度とコースを PDF に合わせる（今：${state.entrance}年度入学・${COURSE_TYPES[state.courseType]}）</label>`
        : ""
    }
    <div class="import-table-wrap"><table class="import-table">
      <thead><tr><th></th><th>PDF の科目名</th><th>このアプリの科目</th><th>学期</th><th>結果</th></tr></thead>
      <tbody>${r.rows
        .map(
          (x, i) => `
        <tr class="${x.problem ? "is-ng" : ""}">
          <td><input type="checkbox" data-row="${i}" ${x.problem ? "disabled" : "checked"} aria-label="${esc(x.pdfName)}を取り込む"></td>
          <td>${esc(x.pdfName)}</td>
          <td>${x.course ? esc(x.course.name) : "—"}</td>
          <td>${x.term ? TERM_LABEL(x.term) : "—"}</td>
          <td>${esc(x.problem || x.note || (x.score != null ? `${x.score}点` : x.result))}</td>
        </tr>`,
        )
        .join("")}</tbody>
    </table></div>
    <div class="import-actions">
      <button value="cancel">やめる</button>
      <button value="apply" class="primary" id="importApply">取り込む</button>
    </div>`;
}

// 「取り込む」「やめる」はどちらもフォームの送信（method="dialog"）でダイアログを閉じる。
// 閉じたあとの close イベントは環境によって届かないことがあるので、送信の時点で取り込む
// e.submitter：押されたボタン。「取り込む」（value=apply）のときだけ取り込む
importBody.addEventListener("submit", (e) => {
  if (e.submitter?.value === "apply" && importResult) applyImport();
  importResult = null;
});

// チェックした行を履修計画に入れて、保存して描き直す
function applyImport() {
  const r = importResult;
  // 「入学年度とコースを PDF に合わせる」にチェックがあれば、上部バーの設定も変える
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
    // その科目の計画（なければ空で作る）と、同じ学期の回
    const p = (state.plan[x.course.id] ||= { attempts: [] });
    const same = p.attempts.find((a) => a.term === x.term);
    // 成績通知書：点数を入れる。同じ学期の回があれば点数を上書き、なければ回を足す
    if (r.kind === "grades") {
      // 点数はその学期の回に入れる（履修中なら予定のまま）
      if (same) {
        if (x.score != null) same.score = x.score;
      } else p.attempts.push({ term: x.term, score: x.score });
      // 履修登録の通知書：その学期の回がなければ、予定の回を足す（点数のある回は変えない）
    } else if (!same) {
      p.attempts.push({ term: x.term, score: null });
    }
    // PDF に講義コードがあれば、選んだクラスとして残す
    if (x.code) p.code = x.code;
    sortAttempts(p.attempts);
    count++;
  });
  save();
  render();
  showToast(`${count}科目を取り込みました`);
}

// 画面全体を描く：一覧と、開いていればサイドバー
function render() {
  renderList();
  if (!sidebar.hidden) renderSidebar();
}
// ---- 8. ページを開いたときの最初の描画（ここまでで準備が全部終わっている） ----
render();
