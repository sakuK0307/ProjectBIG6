// 成績通知書（試験成績一覧表）・履修登録科目確認通知書の PDF を読み取る
// PDF はブラウザの中だけで読む（どこにも送らない）。文字の取り出しには pdf.js を使う
//
// 使い方：
//   const result = await PdfImport.read(file, { courses, inCourseType, fallbackType });
//     fallbackType：PDF にコースが書かれていないとき（1年次は「なし」）に使うコース（"advanced" / "general"）
//   result = {
//     kind: "grades" | "registration",  // 試験成績一覧表 / 履修登録科目確認通知書
//     title, issued, entrance, courseType, // 書類名・発行日・入学年度・コース（読めたものだけ）
//     rows: [{ pdfName, course, term, score, result, code, note, problem }],
//   }
window.PdfImport = (() => {
  // pdf.js 本体と、日本語フォント用の対応表（cmaps）を同じ場所から読む（cdnjs には cmaps がない）
  const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/";
  const PDFJS_URL = PDFJS_BASE + "build/pdf.min.js";
  const WORKER_URL = PDFJS_BASE + "build/pdf.worker.min.js";
  const CMAP_URL = PDFJS_BASE + "cmaps/";
  const FONT_URL = PDFJS_BASE + "standard_fonts/";
  const TERMS = ["1前", "1後", "2前", "2後", "3前", "3後", "4前", "4後"];
  const PERIOD = "(前期集中|後期集中|通年集中|前期|後期|通年|集中)";
  const KIND = "(必修|選必|選択|自由)";

  // ---- pdf.js は「PDF読込」を押したときに初めて読み込む ----
  let loading = null;
  function loadPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    loading ||= new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PDFJS_URL;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { loading = null; reject(new Error("PDF を読むための部品（pdf.js）を読み込めませんでした")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // pdf.js が返す文字は描画した順なので、表の列の順がばらばらになる。
  // 文字の位置（座標）で「上から下へ行ごと、行の中は左から右へ」並べ直す
  async function extractText(file) {
    const lib = await loadPdfjs();
    const doc = await lib.getDocument({
      data: await file.arrayBuffer(),
      // 日本語のフォント（CID フォント）の文字を読むための対応表
      cMapUrl: CMAP_URL, cMapPacked: true, standardFontDataUrl: FONT_URL,
    }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      const items = content.items.filter((it) => it.str && it.str.trim())
        .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5] }));
      const lines = [];
      for (const it of items) {
        const line = lines.find((l) => Math.abs(l.y - it.y) < 2.5);
        if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
      }
      lines.sort((a, b) => b.y - a.y);
      pages.push(lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((it) => it.s).join(" ")).join("\n"));
    }
    return pages.join("\n");
  }

  // 全角英数・全角スペース・半角カナをそろえ、空白を1つにする
  const flatten = (t) => t.normalize("NFKC").replace(/\s+/g, " ");

  // 科目名の照合用：「英語コミュニケーション１」と「英語コミュニケーションⅠ」を同じにする
  const ROMAN = [["IV", "4"], ["III", "3"], ["II", "2"], ["I", "1"], ["V", "5"]];
  function normName(s) {
    let t = String(s).normalize("NFKC")
      .replace(/^\[遠\]/, "")
      .replace(/\*+$/, "") // 後期の履修登録通知書では、前期の科目に * が付く
      .replace(/[<(\[].*?[>)\]]/g, "")
      .replace(/[\s・･]/g, "");
    for (const [r, a] of ROMAN) {
      if (t.endsWith(r)) { t = t.slice(0, -r.length) + a; break; }
    }
    return t;
  }

  // 学年＋期間 → "2前" など
  function toTerm(grade, period, course) {
    if (!(grade >= 1 && grade <= 4)) return null;
    let half = period.startsWith("前") ? "前" : period.startsWith("後") ? "後" : null;
    if (!half) half = course?.terms?.[0]?.[1] || "前"; // 通年・集中は標準の学期に合わせる
    return `${grade}${half}`;
  }

  // 表題などは1文字ずつ分かれていることがあるので、空白を除いた文字で探す
  function readMeta(spaced) {
    const text = spaced.replace(/ /g, "");
    const meta = {};
    // 日付は空白を除くと隣の数字とつながるので、空白ありの文字で探す
    const issued = spaced.match(/(20\d\d)\/ ?(\d{1,2})\/ ?(\d{1,2})(?!\d)/);
    if (issued) meta.issued = `${issued[1]}-${issued[2].padStart(2, "0")}-${issued[3].padStart(2, "0")}`;
    const ent = text.match(/入学年月日 ?: ?(20\d\d)/) || text.match(/適用カリキュラム年度 ?: ?(20\d\d)/);
    if (ent) meta.entrance = Number(ent[1]);
    // 「コース・専修：情報工学先進プロジェクトコース」。1年次は「なし」
    const course = text.match(/コース・専修:(なし|[^:]*?コース)/);
    if (course) meta.courseType = /先進/.test(course[1]) ? "advanced" : /総合/.test(course[1]) ? "general" : null;
    const grade = text.match(/年次 ?: ?(\d)年次/);
    if (grade) meta.grade = Number(grade[1]);
    return meta;
  }

  function scoreOf(token) {
    if (/^\d{1,3}$/.test(token)) return { score: Math.min(100, Number(token)), result: token };
    if (token === "履修") return { score: null, result: "履修中" };
    if (/^[NＮ]$/.test(token)) return { score: 60, result: "認定", note: "認定科目（60点として取り込み）" };
    return { score: null, result: token, problem: `点数「${token}」を読み取れませんでした` };
  }

  // ---- 試験成績一覧表：「科目名 担当教員 単位 年度 区分 期間 点数」の行 ----
  function parseGrades(text, meta, find) {
    const re = new RegExp(`(\\d+\\.\\d) (20\\d\\d) ${KIND} ${PERIOD} (\\S+)`, "g");
    const rows = [];
    let m;
    while ((m = re.exec(text))) {
      // 単位の前にある語のうち、科目表にある名前を科目名とみなす（そのあとは担当教員）
      const before = text.slice(Math.max(0, m.index - 120), m.index).trim().split(" ").slice(-6);
      let course = null, pdfName = before.slice(-3, -2)[0] || before[0] || "";
      for (let k = before.length - 1; k >= 0; k--) {
        const hit = find(before[k]);
        if (hit) { course = hit; pdfName = before[k]; break; }
      }
      const year = Number(m[2]);
      const s = scoreOf(m[5]);
      const term = course && meta.entrance ? toTerm(year - meta.entrance + 1, m[4], course) : null;
      rows.push({
        pdfName: pdfName.replace(/^\[遠\]/, "").replace(/\*+$/, ""), course, term, year, period: m[4], units: Number(m[1]),
        ...s,
        problem: !course ? "科目表にない科目です" : !term ? "学期を決められませんでした" : s.problem,
      });
    }
    return rows;
  }

  // ---- 履修登録科目確認通知書：「講義コード 期間 区分 単位 科目名」の行（点数はない＝予定） ----
  function parseRegistration(text, meta, find) {
    const yearMatch = text.replace(/ /g, "").match(/(20\d\d)年度履修登録科目確認通知書/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const re = new RegExp(`(\\d{6}) ${PERIOD} ${KIND} (\\d+\\.\\d) (\\S+)`, "g");
    const rows = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(text))) {
      if (seen.has(m[1])) continue; // 2コマ続きの授業は2行出るので1つにする
      seen.add(m[1]);
      const course = find(m[5]);
      const grade = year && meta.entrance ? year - meta.entrance + 1 : meta.grade;
      const term = course ? toTerm(grade, m[2], course) : null;
      rows.push({
        pdfName: m[5].replace(/^\[遠\]/, "").replace(/\*+$/, ""), course, term, year, period: m[2], units: Number(m[4]),
        code: m[1], score: null, result: "登録",
        problem: !course ? "科目表にない科目です" : !term ? "学期を決められませんでした" : null,
      });
    }
    return rows;
  }

  // text：PDF から取り出した文字。courses：科目の一覧。inCourseType(course, type)：そのコースの科目か
  function parseText(rawText, { courses, inCourseType, fallbackType = null }) {
    const text = flatten(rawText);
    const meta = readMeta(text);
    // 創造的思考法などはコースで別の科目になるので、どちらのコースの科目に当てるかを決める。
    // PDF にコースがなければ（1年次）、画面で選んでいるコースを使う
    const type = meta.courseType || fallbackType;
    // コースが分かれば、そのコースの科目を優先して照らし合わせる
    const index = new Map();
    const ordered = type ? [...courses.filter((c) => inCourseType(c, type)), ...courses] : courses;
    for (const c of ordered) {
      const key = normName(c.name);
      if (!index.has(key)) index.set(key, c);
    }
    const find = (name) => index.get(normName(name)) || null;

    let kind = null, rows = [];
    const compact = text.replace(/ /g, "");
    if (compact.includes("試験成績一覧表")) {
      kind = "grades";
      rows = parseGrades(text, meta, find);
    } else if (compact.includes("履修登録科目確認通知書")) {
      kind = "registration";
      rows = parseRegistration(text, meta, find);
    }
    const title = kind === "grades" ? "試験成績一覧表" : kind === "registration" ? "履修登録科目確認通知書" : null;
    return { kind, title, ...meta, rows };
  }

  async function read(file, opts) {
    const text = await extractText(file);
    return parseText(text, opts);
  }

  return { read, parseText, normName };
})();
