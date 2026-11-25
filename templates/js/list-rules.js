// 履修リストの「決まりごと」と「判定の計算」（画面には触らない）
//
// ここにあるのは、引数だけから結果を返す関数（純粋な関数）だけ。画面（document）も、サーバーも使わない。
//   ・画面の処理（list.js）と分けておくと、画面を動かさずに計算だけを確かめられる（テストを書くこともできる）
//   ・卒業判定 Excel と同じ式で計算しているところが多いので、間違えると困る部分を 1 か所にまとめる
//
// 判定はフロント（この画面）でする方針。サーバーは科目データと履修計画を渡すだけ。
// 便覧で決まる数（必要単位数・進級の単位数など）は、ここには書かずに「rules」として受け取る
//（rules は scripts/data/rules.json に手で書き、course.json に入って /api/courses で届く）。
// 便覧が変わっても、このファイルを直さずに rules.json を直せば済むようにするため

// ---- 学期・点数 ----

// 学期の並び。indexOf で「何番目か」を出して、学期の前後を比べるのに使う
export const TERMS = ["1前", "1後", "2前", "2後", "3前", "3後", "4前", "4後"];
// "3前" → "3年前期"（t[0] は学年、t[1] は 前/後）
export const TERM_LABEL = (t) => `${t[0]}年${t[1]}期`;
// 卒業判定 Excel と同じく 60 点以上で修得
export const PASS = 60;
// 選べる入学年度（上部バーの選択肢と同じ）
export const ENTRANCE_YEARS = [2023, 2024, 2025, 2026];
// コースの記号 → 画面に出す名前
export const COURSE_TYPES = { advanced: "先進プロジェクトコース", general: "総合コース" };

// 学期 → 何番目か（"1前" は 0、"4後" は 7）
export const termIndex = (t) => TERMS.indexOf(t);
// 履修した回を学期の早い順に並べる（並べ替えた同じ配列を返す）
export const sortAttempts = (list) => list.sort((x, y) => termIndex(x.term) - termIndex(y.term));
// 点数をそろえる：空・数でないものは null（予定）、それ以外は四捨五入して 0〜100 に収める
// 入力欄に 150 や -5 や 72.6 が入っても、おかしな値が保存されないようにするため
export const cleanScore = (v) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? null : Math.max(0, Math.min(100, Math.round(Number(v))));
// 単位数の表示：整数ならそのまま、0.5 単位などは小数1けた
export const fmtCredit = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ---- コース・入学年度 ----

// 科目 c をコース type で表示するか、を判定する関数を作る。
// 卒業判定 Excel の hidden の行は総合コース用。その行と同じ名前の行と「先進プロジェクト」で始まる科目は先進コース用
//（創造的思考法・PBL概論などは、先進では必修、総合では選必・選択になるので、同じ名前の行が 2 つある）
// どちらのコースの科目かは、科目データの courseType（"both"・"advanced"・"general"）に書いてある
//（scripts/build_course_data.py が卒業判定 Excel と rules.json の advancedOnly から決める）
export const inCourseType = (c, type) => c.courseType === "both" || c.courseType === type;

// 科目の標準の学期。入学年度で違う科目（termsByYear）はその年度の値、なければいつもの terms
export const termsOf = (c, entrance) => c.termsByYear?.[entrance] || c.terms;

// 入学年度の決まりで卒業要件に数えない科目か（rules.notCounted に書いてある科目）。
// 例：2023 年度入学の先進コースでは「情報技術の応用と職業」は教職課程として履修できるが、
// 進級・卒業研究着手・卒業の単位には数えない（2023 年度便覧 2-24）
export const notCountedFor = (c, entrance, type, rules) =>
  (rules.notCounted || []).some(
    (r) => r.entrance.includes(entrance) && r.courseType === type && c.courseType !== "general" && c.name === r.name,
  );

// ---- 保存データ ----

// サーバーから受け取った 1 科目分を整える（学期がおかしい回は外し、点数は 0〜100 の整数にそろえ、学期順に並べる）
export function normalizePlan(v) {
  if (!v || !Array.isArray(v.attempts)) return null;
  const attempts = sortAttempts(
    v.attempts.filter((a) => a && TERMS.includes(a.term)).map((a) => ({ term: a.term, score: cleanScore(a.score) })),
  );
  if (!attempts.length) return null;
  const p = { attempts };
  if (v.code) p.code = v.code;
  return p;
}

// サーバーから受け取った履修計画（src）のうち、使える値だけを取り出す。
// 返すのは { plan } と、正しい値だったときだけ term・entrance・courseType（無ければ画面の初期値のまま）
// knownIds：今の科目一覧にある ID（科目データが変わって消えた科目は読み飛ばす）
export function readSavedPlan(src, knownIds) {
  const out = { plan: {} };
  try {
    if (!src || typeof src !== "object") return out;
    if (TERMS.includes(src.term)) out.term = src.term;
    if (COURSE_TYPES[src.courseType]) out.courseType = src.courseType;
    if (ENTRANCE_YEARS.includes(src.entrance)) out.entrance = src.entrance;
    for (const [id, v] of Object.entries(src.plan || {})) {
      if (!knownIds.has(id)) continue;
      const p = normalizePlan(v);
      if (p) out.plan[id] = p;
    }
  } catch {
    /* 形がおかしいデータは読み飛ばす */
  }
  return out;
}

// ---- 修得・不可・予定（卒業判定 Excel と同じく、再履修したら最高点で判定する） ----

// 1 回分の状態：点数が無ければ予定、60 点以上なら修得、それ未満なら不可（key は CSS のクラス名）
export const attemptStatus = (a) => {
  if (a.score == null) return { key: "is-plan", label: "予定" };
  return a.score >= PASS ? { key: "is-pass", label: "修得" } : { key: "is-fail", label: "不可" };
};

// 1 科目分（p）のまとめ。一覧・合計・サイドバー・判定は、みんなこの結果を使う
export function summaryOf(p) {
  const attempts = p?.attempts || [];
  const scores = attempts.map((a) => a.score).filter((x) => x != null);
  // いちばん高い点数で判定する
  const best = scores.length ? Math.max(...scores) : null;
  const earned = best != null && best >= PASS;
  const plannedAttempt = attempts.find((a) => a.score == null);
  // 単位を数える学期：修得した最初の回、まだなら予定の回
  const countTerm = earned
    ? attempts.find((a) => a.score != null && a.score >= PASS).term
    : plannedAttempt
      ? plannedAttempt.term
      : null;
  // 科目全体の状態。修得 > 予定 > 不可 の順で決める（予定の回があれば、まだ取れる見込みがある）
  const status = !attempts.length
    ? { key: "", label: "" }
    : earned
      ? { key: "is-pass", label: "修得" }
      : plannedAttempt
        ? { key: "is-plan", label: "予定" }
        : { key: "is-fail", label: "不可" };
  const last = attempts[attempts.length - 1];
  // 最後の回が不可で、まだ修得していなければ再履修を追加できる
  const canRetake = !earned && !!last && last.score != null && last.score < PASS;
  return { attempts, best, earned, planned: !!plannedAttempt, countTerm, status, canRetake };
}

// 卒業判定に数えるか：修得済み、または予定がある。
// 予定も数えるのは、卒業判定 Excel で予定の科目に 60 点を入れて見込みを出すのと同じ考え方
export const counts = (p) => {
  const s = summaryOf(p);
  return s.earned || s.planned;
};

// ---- 入力の注意 ----

// その回の学期についての注意（開講していない学期・上の学年の授業）。注意がなければ空文字。
// 点数を入れた回は「実際に取った」記録なので出さない（時間割表は今年度のものだけで、過去の年度と違うことがある）
// timetableYear：時間割表の年度、entrance：入学年度
export function attemptWarning(c, a, { timetableYear, entrance }) {
  if (!a || a.score != null) return "";
  const sem = a.term[1] === "前" ? "前期" : "後期";
  const grade = Number(a.term[0]);
  // その学期（または通年）に開講しているクラス
  const offers = (c.offers || []).filter((o) => o.sem === sem || o.sem === "通年");
  // 開講クラスはあるのに、その学期には 1 つもない → 開講していない学期を選んでいる
  //（開講クラスが 1 つもない科目は、時間割表に載っていないだけかもしれないので注意しない）
  if (c.offers?.length && !offers.length) {
    return `${sem}は開講していません（${timetableYear}年度の時間割表）`;
  }
  // 上の学年の授業は履修できない。開講クラスの学年（grade）、無ければ標準の学期の学年で判定する
  //（今の科目データの開講クラスには学年が無いので、実際は標準の学期の学年で判定している）。9 は「分からない」の印
  const grades = offers.map((o) => o.grade).filter(Boolean);
  const minYear = grades.length ? Math.min(...grades) : Math.min(...termsOf(c, entrance).map((t) => Number(t[0])), 9);
  if (minYear !== 9 && grade < minYear) return `${minYear}年次の科目です（上の学年の授業は履修できません）`;
  return "";
}

// ---- 卒業判定（卒業判定 Excel「総合判定」「PC/DE/HM/NS」シートと同じ式） ----

// 卒業に必要な 9 項目。[画面に出す名前, 科目データの req の記号]。必要単位数はこの並び順で 9 個の数が入っている
export const REQS = [
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
// 4 つのプログラム [記号, 名前]
export const PROGRAMS = [
  ["PC", "フィジカルコンピューティング"],
  ["DE", "データエンジニアリング"],
  ["HM", "ヒューマン・メディア"],
  ["NS", "ネットワークシステム"],
];

// 判定に使う材料をまとめる（画面の state から作る）。
//   allCourses：両コースの全科目、byId：ID → 科目、plan：履修計画、courseType・entrance：今の設定、
//   rules：判定の決まりごと（必要単位数 rules.requirements と、rules.json に書いたもの）
export function makeContext({ allCourses, byId, plan, courseType, entrance, rules }) {
  // 今のコースの必要単位数 { PC: [9 個], … }
  const requirements = rules.requirements[courseType];
  // 今のコースで表示・集計する科目
  const courses = allCourses.filter((c) => inCourseType(c, courseType));
  // 卒業判定・単位の集計に数えるか（今のコースの科目で、自由科目でなく、入学年度の決まりで除かれていないもの）
  // c && … は、科目が見つからない（undefined）ときに false にするため
  const isCounted = (c) =>
    !!c && inCourseType(c, courseType) && c.kind !== "自由" && !notCountedFor(c, entrance, courseType, rules);
  return { byId, plan, courseType, entrance, requirements, rules, courses, isCounted };
}

// 判定に数える科目と、その計画の一覧 [{ c, p }]
export const countedCourses = (ctx) =>
  Object.entries(ctx.plan)
    .map(([id, p]) => ({ c: ctx.byId.get(id), p }))
    .filter((x) => ctx.isCounted(x.c) && counts(x.p));

// upto：この学期までに修得・予定の科目だけで数える（null なら全部）
// 返すもの：プログラムごとの 9 項目と残り最低科目数、合計単位、情報工学基礎科目の数、DS・AI の数
export function evaluate(ctx, upto) {
  const limit = upto ? termIndex(upto) : Infinity;
  const within = (p) => {
    const t = summaryOf(p).countTerm;
    return t != null && termIndex(t) <= limit;
  };
  const counted = countedCourses(ctx).filter((x) => within(x.p));
  const countedIds = new Set(counted.map((x) => x.c.id));
  // 集計区分 key（例「総計」「DE◎」）に入る科目の単位数の合計
  const sumReq = (key) => counted.filter((x) => x.c.req.includes(key)).reduce((s, x) => s + x.c.credits, 0);
  // まだ数えられない必修科目の数（Excel の M23：必修科目の不足科目数）
  const requiredMissing = ctx.courses.filter((c) => c.req.includes("必") && !countedIds.has(c.id)).length;
  const programs = PROGRAMS.map(([p, name]) => {
    const rows = REQS.map(([label, key], i) => ({
      label,
      need: ctx.requirements[p]?.[i] ?? 0,
      // ◎・※・○ はプログラムごとに違うので「DE◎」のように記号を付ける。ほかの項目は共通
      got: sumReq(["◎", "※", "○"].includes(key) ? p + key : key),
    }));
    // Excel の列に合わせた名前：b＝必要、c＝修得、l＝不足（マイナスにはしない）
    const b = rows.map((r) => r.need),
      c = rows.map((r) => r.got);
    const l = b.map((v, i) => Math.max(v - c[i], 0));
    const up = Math.ceil;
    // m[i]：項目 i の不足を埋めるのに、あと最低何科目いるか（Excel M19〜M27）。合計が「残り最低○科目」
    // 1 科目＝2 単位で考え、項目どうしの重なり（例：理工基礎の指定は選択必修にも数える）を引いている
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
    // done：9 項目すべて足りていれば、そのプログラムを修了
    return { p, name, rows, done: rows.every((r) => r.got >= r.need), needed: m.reduce((a, v) => a + v, 0) };
  });
  return {
    programs,
    // 修得単位数（総合基礎の合計＋専門の合計）。進級・研究ゼミの判定に使う
    totalUnits: sumReq("総計") + sumReq("専計"),
    infoBasic: counted.filter((x) => x.c.req.includes("基礎")).length,
    dsai: counted.filter((x) => x.c.dsai).length,
    // 4 プログラムのうち、いちばん少ない残り科目数（卒業研究着手の判定に使う）
    minNeeded: Math.min(...programs.map((x) => x.needed)),
  };
}

// 進級・研究ゼミナール・卒業研究着手・卒業・DS・AI の判定（Excel「総合判定」シート、学生便覧の条件）。
// all：evaluate(ctx, null) の結果。
// 返すのは判定の一覧 [{ title, ok, optional?, note, metrics: [{ label, got, need, unit, less? }] }]
//   metrics はプログレスバーにする値。less: true は「need 以下なら充足」（残り科目数など）
export function judgments(ctx, all) {
  // 条件の数は rules.judgments（scripts/data/rules.json）から。upto は「いつまでの分で数えるか」
  const J = ctx.rules.judgments;
  // 判定ごとに「いつまでの分で数えるか」が違うので、区切りを変えて evaluate を呼ぶ
  const adv = evaluate(ctx, J.advance.upto); // 3 年次への進級：2 年次終了まで
  const semi = evaluate(ctx, J.seminar.upto); // 研究ゼミナール（3 年後期）：履修開始時まで
  const thesis = evaluate(ctx, J.thesis.upto); // 卒業研究（4 年）：着手時まで
  const items = [];
  items.push({
    title: "3年次への進級",
    ok: adv.infoBasic >= J.advance.infoBasic && adv.totalUnits >= J.advance.units,
    note: `${TERM_LABEL(J.advance.upto)}までの修得で判定`,
    metrics: [
      { label: "情報工学基礎科目", got: adv.infoBasic, need: J.advance.infoBasic, unit: "科目" },
      { label: "修得単位数", got: adv.totalUnits, need: J.advance.units, unit: "単位" },
    ],
  });
  // 2024 年度入学以降（thesisBlockedFrom）：卒業研究を研究ゼミナールと同じか前の学期に取っていたら、研究ゼミナールは履修できない
  //（研究ゼミナールと卒業研究を、最初に登録した学期で比べる）
  const semiCourse = ctx.courses.find((c) => c.name === "研究ゼミナール");
  const thesisCourse = ctx.courses.find((c) => c.name === "卒業研究");
  const semiTerm = semiCourse && ctx.plan[semiCourse.id]?.attempts[0]?.term;
  const thesisTerm = thesisCourse && ctx.plan[thesisCourse.id]?.attempts[0]?.term;
  const blocked =
    ctx.entrance >= J.seminar.thesisBlockedFrom &&
    semiTerm &&
    thesisTerm &&
    termIndex(thesisTerm) <= termIndex(semiTerm);
  items.push({
    title: "研究ゼミナールの履修",
    ok: semi.totalUnits >= J.seminar.units && !blocked,
    note:
      `${TERM_LABEL(J.seminar.upto)}までの修得で判定` +
      (blocked ? "。卒業研究を履修中・修得済みの学期には履修できません" : ""),
    metrics: [{ label: "修得単位数", got: semi.totalUnits, need: J.seminar.units, unit: "単位" }],
  });
  items.push({
    title: "卒業研究の着手",
    ok: thesis.minNeeded <= J.thesis.maxRemaining,
    note: `${TERM_LABEL(J.thesis.upto)}までの修得で判定`,
    metrics: [
      { label: "卒業まで残り最低", got: thesis.minNeeded, need: J.thesis.maxRemaining, unit: "科目", less: true },
    ],
  });
  // 卒業：どれか 1 つのプログラムを修了すればよいので、4 プログラムの 9 項目の充足数を並べる
  const doneProgs = all.programs.filter((x) => x.done).map((x) => x.p);
  items.push({
    title: "卒業",
    ok: doneProgs.length > 0,
    note: doneProgs.length
      ? `${doneProgs.join("・")} プログラム修了`
      : `いずれか1つのプログラムの修了が必要（残り最低 ${fmtCredit(all.minNeeded)} 科目）`,
    metrics: all.programs.map((x) => ({
      label: `${x.p} 修了要件`,
      got: x.rows.filter((r) => r.got >= r.need).length,
      need: 9,
      unit: "項目",
    })),
  });
  items.push({
    title: "DS・AI サブカリキュラム",
    ok: all.dsai >= J.dsai.courses,
    optional: true,
    note: "登録者のみ",
    metrics: [{ label: "対象科目", got: all.dsai, need: J.dsai.courses, unit: "科目" }],
  });
  return items;
}
