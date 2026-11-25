"""授業時間割表の PDF から、科目ごとの開講クラス（講義コード・曜日時限・教室・担当）の JSON を作る

使い方（リポジトリ直下で）:
    python scripts/timetable_to_json.py [--csv] [時間割表 PDF] [科目 JSON] [出力 JSON]

    時間割表 PDF の初期値: scripts/materials/*info_eng01.pdf のうち一番新しい年度のもの
    科目 JSON の初期値:    scripts/data/excel_*.json のうち一番新しい年度のもの（excel_to_json.py の出力）
    出力の初期値:          scripts/data/timetable_<年度>.json（年度は PDF の表題から読む）

    --csv を付けると、PDF から読み取った表（科目と照らし合わせる前）も
    scripts/data/timetable_<年度>.csv に書き出す。読み取りが正しいかを Excel で確かめるため。
    （この CSV は確かめる用で、JSON を作るときには読まない。手で補う分は timetable_extra.csv に書く）

手で確かめた講義コード（PDF から読み取れない科目）は scripts/data/timetable_extra.csv に書く。
科目の一覧は excel_*.json（Excel に無い自由科目も excel_to_json.py が入れてある）。
科目名をそろえて（「A：」などのクラス記号、<抽選>・(隔週A) などの注記、①② を除く）科目 JSON の科目と照らし合わせる。

必要なもの: pip install pdfplumber
"""
import csv, json, re, sys, unicodedata, collections
from pathlib import Path

import pdfplumber

HERE = Path(__file__).resolve().parent
MATERIALS = HERE / "materials"  # 元の資料（Excel・時間割表・便覧）
DATA = HERE / "data"            # できあがったデータ
CODE = re.compile(r"64\d{4}")


# ==== 1. PDF の表を読む（罫線からセルを復元する） ====
# 表の構造:
#   行 = 学年 × 時限（左端の「学年」「時限」列。結合セル）
#   列 = 曜日ごとに「時間割番号・科目・担当者・教室」の4列（土曜は右上の別表で、学年・時限列を持つ）
DAYS = "月火水木金土"


def uniq(values, tol=2.0):
    out = []
    for v in sorted(values):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def words_in(words, x0, x1, y0, y1):
    """中心が矩形内にある単語を、行→左から の順で"""
    ws = [w for w in words
          if x0 <= (w["x0"] + w["x1"]) / 2 <= x1 and y0 <= (w["top"] + w["bottom"]) / 2 <= y1]
    return sorted(ws, key=lambda w: (round(w["top"]), w["x0"]))


def lines_of(ws):
    """単語を行ごとにまとめた文字列のリスト"""
    rows = {}
    for w in ws:
        key = next((k for k in rows if abs(k - w["top"]) < 3), w["top"])
        rows.setdefault(key, []).append(w)
    return ["".join(v["text"] for v in sorted(r, key=lambda v: v["x0"])) for _, r in sorted(rows.items())]


class Page:
    def __init__(self, page):
        self.p = page
        self.words = page.extract_words()
        self.h = [e for e in page.edges if e["orientation"] == "h"]
        self.v = [e for e in page.edges if e["orientation"] == "v"]
        heads = [w for w in self.words if w["text"] == "科目"]
        self.head_top = min(w["top"] for w in heads)
        self.semester = "後期" if "後期" in (page.extract_text() or "")[:400] else "前期"

    def columns(self):
        """見出し行を横切る縦線 → 列の [x0, x1] と種類"""
        y = self.head_top + 4
        xs = uniq([e["x0"] for e in self.v if e["top"] <= y <= e["bottom"]])
        label_words = [w for w in self.words if self.head_top - 25 <= w["top"] <= self.head_top + 20]
        cols = []
        for x0, x1 in zip(xs, xs[1:]):
            if x1 - x0 < 8:
                continue
            texts = "".join(w["text"] for w in label_words if x0 <= (w["x0"] + w["x1"]) / 2 <= x1)
            kind = ("code" if "番号" in texts or "時間割" in texts else
                    "subject" if "科目" in texts else
                    "teacher" if "担当者" in texts else
                    "room" if "教室" in texts else
                    "grade" if "学年" in texts else
                    "period" if "時限" in texts else None)
            cols.append({"x0": x0, "x1": x1, "kind": kind})
        # 本表の左端: 「学年」の次の見出しなし列が「時限」（縦書きで見出しが単語にならない）
        for i, c in enumerate(cols):
            if c["kind"] == "grade" and i + 1 < len(cols) and cols[i + 1]["kind"] is None:
                cols[i + 1]["kind"] = "period"
        return cols

    def cells(self, col, y0, y1):
        """列を横切る横線で区切ったセル [(top, bottom)]"""
        cx0, cx1 = col["x0"] + 2, col["x1"] - 2
        ys = uniq([e["top"] for e in self.h
                   if e["x0"] <= cx0 and e["x1"] >= cx1 and y0 - 1 <= e["top"] <= y1 + 1])
        return [(a, b) for a, b in zip(ys, ys[1:]) if b - a > 4]

    def border_bottom(self, x, y):
        """x の位置の縦線を、y からつながっている所まで下にたどった下端（セルごとの短い線をつなぐ）"""
        segs = sorted((e["top"], e["bottom"]) for e in self.v if abs(e["x0"] - x) < 2)
        bottom = y
        for top, bot in segs:
            if top <= bottom + 3 and bot > bottom:
                bottom = bot
        return bottom if bottom > y else self.p.height

    def bands(self, period_col, y0, y1):
        """時限の帯 [(top, bottom, 時限, 学年)]。数字のあるセルから次の数字のセルまで。
        学年は、時限が前の帯以下に戻るたびに1つ進める（縦書きの学年欄は読まない）"""
        labeled = []
        for c in self.cells(period_col, y0, y1):
            m = re.search(r"[1-7]", self.text(period_col, c))
            if m:
                labeled.append((c[0], int(m.group(0))))
        out, grade, prev = [], 1, 0
        for i, (top, period) in enumerate(labeled):
            if period <= prev:
                grade += 1
            prev = period
            bottom = labeled[i + 1][0] if i + 1 < len(labeled) else y1
            out.append((top, bottom, period, grade))
        return out

    def cell_at(self, cells, y):
        return next(((a, b) for a, b in cells if a <= y <= b), None)

    def text(self, col, cell, sep=""):
        if not cell:
            return ""
        return sep.join(lines_of(words_in(self.words, col["x0"], col["x1"], cell[0], cell[1])))

    def parse(self):
        cols = self.columns()
        days = sorted([w for w in self.words if w["text"] in DAYS and w["top"] < self.head_top],
                      key=lambda w: w["x0"])
        rows = []
        for si, sub in enumerate(cols):
            if sub["kind"] != "subject":
                continue
            # この科目列の曜日（見出しの曜日の文字が、番号列〜教室列の範囲にある）
            code_col = cols[si - 1] if si > 0 and cols[si - 1]["kind"] == "code" else None
            if code_col is None:
                continue  # 集中科目などの別表
            right = [c for c in cols[si + 1:si + 3]]
            teacher_col = next((c for c in right if c["kind"] == "teacher"), None)
            room_col = next((c for c in right if c["kind"] == "room"), None)
            block_x1 = (room_col or teacher_col or sub)["x1"]
            day = next((w["text"] for w in days if code_col["x0"] - 5 <= (w["x0"] + w["x1"]) / 2 <= block_x1 + 5), None)
            # 時限・学年の列: 左にある一番近いもの
            left = cols[:si]
            period_col = next((c for c in reversed(left) if c["kind"] == "period"), None)
            # 表の下端: 時限列の左の縦線（見出しから続く外枠）が終わる所
            y_top = self.head_top + 12
            y_bot = self.border_bottom(period_col["x0"], self.head_top + 4)
            bands = self.bands(period_col, y_top, y_bot)
            if not bands:
                continue
            sub_cells = self.cells(sub, y_top, y_bot)
            code_cells = self.cells(code_col, y_top, y_bot)
            t_cells = self.cells(teacher_col, y_top, y_bot) if teacher_col else []
            r_cells = self.cells(room_col, y_top, y_bot) if room_col else []
            for cell in sub_cells:
                lines = lines_of(words_in(self.words, sub["x0"], sub["x1"], cell[0], cell[1]))
                if not lines:
                    continue
                # 「※」以降は注記（行頭でも行の途中でも。次の行に続く注記もまとめて）
                text = "\n".join(lines)
                name, _, rest = text.partition("※")
                name = name.replace("\n", "")
                note = ("※" + rest.replace("\n", "")) if rest else ""
                mid = (cell[0] + cell[1]) / 2
                code = CODE.search(self.text(code_col, self.cell_at(code_cells, mid)) or "")
                band = next((b for b in bands if b[0] <= mid < b[1]), None)
                if band is None:
                    continue
                # 担当者・教室: 科目セルと重なるセルを全部
                over = lambda cs: [c for c in cs if c[0] < cell[1] - 1 and c[1] > cell[0] + 1]
                teacher = "・".join(t for t in (self.text(teacher_col, c) for c in over(t_cells)) if t) if teacher_col else ""
                room = " ".join(t for t in (self.text(room_col, c, " ") for c in over(r_cells)) if t) if room_col else ""
                rows.append({
                    "code": code.group(0) if code else "",
                    "semester": self.semester,
                    "grade": band[3],
                    "day": day or "",
                    "period": band[2],
                    "name": name, "teacher": teacher, "room": room, "note": note,
                })
        return rows


def fill_from_notes(rows, notes):
    """表の中に番号がなく、欄外に「科目名（時間割番号：NNNNNN）」とあるもの（卒業研究など）"""
    for r in rows:
        if not r["code"] and r["name"] in notes:
            r["code"] = notes[r["name"]]
    return rows


def fill_continuations(rows):
    """2コマ続きの授業: 番号のない行に、同じ曜日・学年・科目名の隣のコマの番号を入れる"""
    for r in rows:
        if r["code"] or not r["period"]:
            continue
        for d in (1, -1, 2, -2):
            m = next((x for x in rows if x["code"] and x["day"] == r["day"] and x["grade"] == r["grade"]
                      and x["name"] == r["name"] and x["period"] == r["period"] - d), None)
            if m:
                r["code"] = m["code"]
                r["note"] = (r["note"] + " " if r["note"] else "") + f"（{m['period']}限からの続き）"
                break
    return rows




def read_pdf(path):
    rows, notes, year = [], {}, None
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if year is None:
                m = re.search(r"(20\d\d)\s*年度", text)
                year = int(m.group(1)) if m else None
            rows += Page(page).parse()
            for name, code in re.findall(r"([^\s　（(]+)（時間割番号：(64\d{4})）", text):
                notes[name] = code
    return fill_continuations(fill_from_notes(rows, notes)), year


# ==== 2. 科目 JSON の科目と照らし合わせて、講義コードごとにまとめる ====
ROMAN = {"IV": "4", "III": "3", "II": "2", "I": "1", "V": "5"}


def norm(s):
    s = re.sub(r"[①-⑳]", "", s or "")             # ①② は NFKC で数字になるので先に消す
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"^[A-Z]{1,2}\s*:\s*", "", s)         # A： AB： などのクラス記号
    s = re.sub(r"[<(\[].*?[>)\]]", "", s)            # <抽選> (隔週A) (再) など
    s = re.sub(r"[\s・]", "", s)                       # 「プラクティカル・イングリッシュ」と「プラクティカルイングリッシュ」
    # 末尾のローマ数字をアラビア数字に（「実験Ⅱ」と「実験2」）
    return re.sub(r"(IV|III|II|I|V)$", lambda m: ROMAN[m.group(1)], s)



def biweekly(name):
    """「(隔週A)」「（隔週B)」→ "A" / "B"（隔週でなければ None）"""
    m = re.search(r"隔週\s*([AB])", unicodedata.normalize("NFKC", name))
    return m.group(1) if m else None




def build_links(rows, courses):
    by_name = collections.defaultdict(list)
    for r in rows:
        by_name[norm(r["name"])].append(r)

    links, missing = {}, []
    for c in courses:
        found = by_name.get(norm(c["name"]), [])
        if not found:
            missing.append(c["name"])
            continue
        # 同じ講義コードの行（2コマ続きの授業など）は1つにまとめ、コマを slots に並べる
        by_code = {}
        # 時間割表の行を先に使う（手で加えた timetable_extra.csv の行には、隔週・教室などの情報が無い）
        for r in sorted(found, key=lambda r: (r["semester"] != "前期", bool(r.get("extra")), r["name"], r["code"], str(r.get("period", "")))):
            l = by_code.setdefault(r["code"], {
                "code": r["code"],
                "label": r["name"],
                "semester": r["semester"],
                "grade": int(r["grade"]) if r.get("grade") else None,
                "day": r["day"] or None,
                "period": int(r["period"]) if r["period"] else None,
                "room": r["room"] or None,
                "teacher": r.get("teacher") or None,
                "note": (r.get("note") or "").split("（")[0].strip() or None,
                "biweekly": biweekly(r["name"]),
                "slots": [],
            })
            if r["semester"] != l["semester"]:
                l["semester"] = "通年"   # 前期・後期の両方の表にある（卒業研究など）
            if r["day"] and r["period"]:
                slot = {"day": r["day"], "period": int(r["period"])}
                if slot not in l["slots"]:
                    l["slots"].append(slot)
        for l in by_code.values():
            # 卒業研究のように表の全コマを埋めているものは、決まったコマの授業ではない
            if len(l["slots"]) > 12:
                l["slots"], l["day"], l["period"] = [], None, None
                l["note"] = "研究室ごとに実施（時間割表の全コマに記載）"
        links[c["id"]] = list(by_code.values())

    return links, missing


CSV_COLUMNS = ["code", "semester", "grade", "day", "period", "name", "teacher", "room", "note"]


def write_csv(rows, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig: Excel で開いても文字化けしないように
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main():
    want_csv = "--csv" in sys.argv[1:]
    sys.argv = [a for a in sys.argv if a != "--csv"]
    if len(sys.argv) > 1:
        pdf_path = Path(sys.argv[1])
    else:
        pdfs = sorted(MATERIALS.glob("*info_eng01.pdf"))
        if not pdfs:
            sys.exit("scripts/materials に時間割表の PDF（*info_eng01.pdf）がありません\n" + __doc__)
        pdf_path = pdfs[-1]
    if len(sys.argv) > 2:
        cur_path = Path(sys.argv[2])
    else:
        found = sorted(DATA.glob("excel_*.json"))
        if not found:
            sys.exit("scripts/data/excel_*.json がありません。先に excel_to_json.py を実行してください")
        cur_path = found[-1]
    courses = json.load(open(cur_path, encoding="utf-8"))["courses"]

    rows, year = read_pdf(pdf_path)
    if want_csv:
        csv_out = DATA / f"timetable_{year}.csv"
        write_csv(rows, csv_out)
        print(f"PDF から読み取った {len(rows)} 行 -> {csv_out}")
    # PDF から読み取れない科目（結合セルなど）。コードはシラバスを開いて科目名を確認済み
    extra = DATA / "timetable_extra.csv"
    if extra.exists():
        for r in csv.DictReader(open(extra, encoding="utf-8")):
            rows.append({"code": r["code"], "semester": r["semester"], "name": r["name"],
                         "day": "", "period": "", "room": "", "extra": True})

    links, missing = build_links(rows, courses)
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else DATA / f"timetable_{year}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"year": year, "links": links}, f, ensure_ascii=False, indent=1)
    print(f"{len(rows)} 行を読み取り、{len(links)} 科目に開講クラスあり -> {out}")
    print(f"時間割表に見つからなかった科目 {len(set(missing))} 件: {sorted(set(missing))}")


if __name__ == "__main__":
    main()
