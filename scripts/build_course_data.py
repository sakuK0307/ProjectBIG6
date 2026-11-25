"""科目 JSON と開講クラス JSON から、履修リスト画面（list.html）用の科目データ JSON を作る

使い方（リポジトリ直下で）:
    python scripts/build_course_data.py [--csv] [科目 JSON] [開講クラス JSON] [出力 JSON]

    科目 JSON の初期値:       scripts/data/excel_*.json の一番新しいもの（excel_to_json.py の出力）
    開講クラス JSON の初期値: scripts/data/timetable_*.json の一番新しいもの（timetable_to_json.py の出力）
    出力の初期値:             scripts/data/course.json

    --csv を付けると、Excel で確かめる用の CSV も書き出す（JSON を作るときには読まない）:
        scripts/data/course.csv         … 1行 = 1科目（区分 req・標準学期 terms は空白区切り）
        scripts/data/course_offers.csv  … 1行 = 1開講クラス（course_id で科目とつながる。コマ slots は空白区切り）

人が直すデータも読み込む:
    scripts/data/rules.json        … 判定の決まりごと（入学年度で数えない科目、進級などの条件）と、
                                     先進コースだけの科目のうち Excel から分からないもの（advancedOnly）

できる course.json の形:
    {
      "meta":    { "source": [材料にしたファイル] },          … 記録（画面では使わない）
      "timetableYear": 2026,                                … 時間割表の年度（入学年度とは別）
      "rules":   { "requirements": { advanced, general },    … 必要単位数（卒業判定 Excel から）
                   "notCounted": [...], "judgments": {...} },  … rules.json に手で書いた決まりごと
      "courses": [ { …, "courseType": "both" | "advanced" | "general", … } ]
    }

画面は course.json をサーバー（/api/courses）から受け取る。
course.json は自動で作るファイルなので、手で編集しない。
Excel に無い科目（便覧の自由科目）は、excel_to_json.py が excel_extra.csv から excel_*.json に入れてある。
"""
import csv
import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"  # できあがったデータ

# 科目 JSON（excel_*.json）の slot（標準履修学期）: 0=1年前期 … 7=4年後期
TERMS = ["1前", "1後", "2前", "2後", "3前", "3後", "4前", "4後"]
KIND = [("required", "必修"), ("selReq", "選必"), ("elective", "選択"), ("free", "自由")]
# 科目 JSON の categories（集計区分）→ 画面（list.js）の集計キー
CATEGORY = {
    "generalSelReq": "総選", "generalTotal": "総計",
    "scienceDesignated": "理指", "scienceSelReq": "理選",
    "required": "必", "majorTotal": "専計",
}
for p in ("PC", "DE", "HM", "NS"):
    CATEGORY[f"{p}.double"] = f"{p}◎"
    CATEGORY[f"{p}.star"] = f"{p}※"
    CATEGORY[f"{p}.circle"] = f"{p}○"


def dumps(obj):
    """indent 付きの JSON。数字や文字だけの短い配列（必要単位数・区分など）は 1 行にまとめる"""
    text = json.dumps(obj, ensure_ascii=False, indent=1)
    return re.sub(r"\[\s*([^\[\]{}]*?)\s*\]",
                  lambda m: "[" + re.sub(r",\s+", ", ", m.group(1)) + "]", text)


def rel(path):
    """リポジトリ直下からのパス（記録用。リポジトリの外なら名前だけ）"""
    try:
        return path.resolve().relative_to(DATA.parent.parent).as_posix()
    except ValueError:
        return path.name


def newest(pattern):
    found = sorted(DATA.glob(pattern))
    if not found:
        sys.exit(f"scripts/data/{pattern} がありません")
    return found[-1]


def write_csv(rows, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig: Excel で開いても文字化けしないように
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def write_csvs(courses):
    write_csv([{
        "id": c["id"], "dept": c["dept"], "group": c["group"], "name": c["name"],
        "kind": c["kind"], "credits": c["credits"], "terms": " ".join(c["terms"]),
        **{f"prog.{p}": m for p, m in c["prog"].items()},
        "req": " ".join(c["req"]), "hidden": c["hidden"], "courseType": c["courseType"], "dsai": c["dsai"],
        "offers": len(c["offers"]),
    } for c in courses], DATA / "course.csv")
    write_csv([{
        "course_id": c["id"], "course_name": c["name"],
        **{k: v for k, v in o.items() if k != "slots"},
        "slots": " ".join(f"{s['day']}{s['period']}" for s in o["slots"]),
    } for c in courses for o in c["offers"]], DATA / "course_offers.csv")
    print(f"CSV -> {DATA / 'course.csv'}, {DATA / 'course_offers.csv'}")


def make_offers(links_for_course):
    """時間割表の開講クラス（timetable_*.json の links の 1 科目分）を、画面用の形にする"""
    offers = []
    for o in links_for_course:
        cls = re.match(r"^(AB|A|B)：", o["label"])
        offers.append({
            "code": o["code"], "label": o["label"], "sem": o["semester"],
            "day": o["day"], "period": o["period"], "slots": o["slots"],
            "cls": cls.group(1) if cls else "", "retake": "再" in o["label"],
            "biweekly": o["biweekly"], "room": o["room"], "teacher": o["teacher"], "note": o["note"],
        })
    return offers


def course_type_of(c, hidden_names, advanced_only):
    """科目をどちらのコースで使うか："general"（総合だけ）・"advanced"（先進だけ）・"both"（両方）
    卒業判定 Excel では、コースで扱いが違う科目（必修か選択か など）を 2 行に分け、総合用の行を非表示にしている"""
    if c["hidden"]:
        return "general"                 # Excel で非表示の行は総合コース用
    if c["name"] in hidden_names:
        return "advanced"                # 総合用と同じ名前の、非表示でない行は先進コース用（例：PBL概論は先進で必修）
    if c["id"] in advanced_only:
        return "advanced"                # 総合用の行が無い先進だけの科目（rules.json の advancedOnly に手で書く）
    return "both"


def main():
    want_csv = "--csv" in sys.argv[1:]
    sys.argv = [a for a in sys.argv if a != "--csv"]
    excel_path = Path(sys.argv[1]) if len(sys.argv) > 1 else newest("excel_*.json")
    tt_path = Path(sys.argv[2]) if len(sys.argv) > 2 else newest("timetable_*.json")
    json_out = Path(sys.argv[3]) if len(sys.argv) > 3 else DATA / "course.json"

    excel = json.load(open(excel_path, encoding="utf-8"))
    timetable = json.load(open(tt_path, encoding="utf-8"))
    links = timetable["links"]

    courses = []
    for c in excel["courses"]:
        kind, credits = next(((label, c["units"][k]) for k, label in KIND if c["units"][k]), ("", 0))
        req = [CATEGORY[k] for k in c["categories"]]
        if c["infoBasic"]:
            req.append("基礎")
        prog = {p: ("必" if m == "必修" else (m or "")) for p, m in c["marks"].items()}
        offers = make_offers(links.get(c["id"], []))
        courses.append({
            "id": c["id"], "dept": c["department"], "group": c["group"] or "", "name": c["name"],
            "kind": kind, "credits": credits,
            "terms": [TERMS[c["slot"]]] if c["slot"] is not None else [],
            "prog": prog, "req": req, "hidden": c["hidden"], "dsai": c["dsai"],
            "offers": offers,
        })
        # Excel に無い科目（excel_extra.csv から excel_to_json.py が足したもの）の印と、その科目だけにある項目
        if c.get("extra"):
            courses[-1]["extra"] = True
            for key in ("termsByYear", "note"):
                if key in c:
                    courses[-1][key] = c[key]

    # 判定の決まりごと（入学年度で数えない科目、進級などの条件）と、先進だけの科目の一覧。手で書いた rules.json
    # 画面（templates/js/list-rules.js）はこれを使って判定する。便覧が変わったら rules.json を直して作り直す
    rules_path = DATA / "rules.json"
    rules = json.loads(rules_path.read_text(encoding="utf-8"))
    # advancedOnly は下で courseType を決めるのに使うだけなので、course.json の rules には入れない
    advanced_only = set(rules.pop("advancedOnly", []))
    unknown = advanced_only - {c["id"] for c in courses}
    if unknown:
        sys.exit(f"rules.json の advancedOnly に、科目データに無い ID があります: {sorted(unknown)}")

    # 科目ごとに、どちらのコースで使うか（courseType）を決める
    hidden_names = {c["name"] for c in courses if c["hidden"]}
    for c in courses:
        c["courseType"] = course_type_of(c, hidden_names, advanced_only)

    data = {
        # 記録：この course.json を何から作ったか（画面では使わない。モックも返す前に外す）
        "meta": {
            "source": [rel(excel_path), rel(tt_path), rel(rules_path)],
        },
        # 時間割表の年度（開講クラス・シラバスのリンクがいつのものか）。入学年度とは別
        "timetableYear": timetable["year"],
        # 判定の決まりごと：必要単位数（卒業判定 Excel から）と、rules.json に手で書いたもの
        "rules": {
            # 必要単位数 { advanced: { PC: [9 個], … }, general: { … } }（先進は B 列、総合は O 列「総合コース用」）
            "requirements": excel["requirements"],
            **rules,
        },
        "courses": courses,
    }
    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(dumps(data) + "\n", encoding="utf-8")

    print(f"{len(courses)} 科目、開講クラス {sum(len(c['offers']) for c in courses)} 件 -> {json_out}")
    if want_csv:
        write_csvs(courses)


if __name__ == "__main__":
    main()
