"""卒業判定 Excel（course_registration_plan.xlsx）から、科目と卒業要件の JSON を作る

使い方（リポジトリ直下で）:
    python scripts/excel_to_json.py [--csv] [Excel のパス] [出力 JSON]

    Excel の初期値: scripts/materials/course_registration_plan.xlsx
    出力の初期値:   scripts/data/excel_<入学年度>.json（入学年度は成績表シートの G1）

    --csv を付けると、科目の一覧（1行 = 1科目）を scripts/data/excel_<入学年度>.csv にも書き出す。
    読み取りが正しいかを Excel で確かめるため（JSON を作るときには読まない）。
    複数の値が入る列（区分・一覧の場所）は空白区切り。必要単位数などは JSON だけにある。

読むのは科目の構造（単位数・区分・プログラム指定・集計区分・必要単位数など）だけで、
成績・学籍番号・氏名は読み出さない。個人情報を抜いた Excel を渡しても同じ結果になる。

Excel に無い科目（学生便覧の自由科目など）は scripts/data/excel_extra.csv に書いておき、ここで Excel の科目と一緒に入れる。
（列：id,name,dept,group,kind,credits,terms,termsByYear,note。同じ部門・科目群の最後の科目のうしろに入れる）
これより後のスクリプト（timetable_to_json.py・build_course_data.py）は、excel_*.json の科目をそのまま使えばよい。

必要なもの: pip install openpyxl
"""
import csv
import json
import re
import sys
from pathlib import Path

import openpyxl
from openpyxl.utils import column_index_from_string as CI

HERE = Path(__file__).resolve().parent
MATERIALS = HERE / "materials"  # 元の資料（Excel・時間割表・便覧）
DATA = HERE / "data"            # できあがったデータ
PROGRAMS = ["PC", "DE", "HM", "NS"]
TERMS = ["1前", "1後", "2前", "2後", "3前", "3後", "4前", "4後"]  # slot の番号（0=1年前期 … 7=4年後期）
# 区分 → units のキー
KIND_UNITS = {"必修": "required", "選必": "selReq", "選択": "elective", "自由": "free"}

# 成績表シートの集計列 → 区分（その列に数式がある科目が、その区分に数えられる）
AGG = {"AI": "generalSelReq", "AJ": "generalTotal", "AK": "scienceDesignated", "AL": "scienceSelReq",
       "AM": "required", "AN": "majorTotal",
       "AP": "PC.double", "AQ": "PC.star", "AR": "PC.circle",
       "AS": "DE.double", "AT": "DE.star", "AU": "DE.circle",
       "AV": "HM.double", "AW": "HM.star", "AX": "HM.circle",
       "AY": "NS.double", "AZ": "NS.star", "BA": "NS.circle"}
# BB 列以降：「修得が必要な科目」の一覧。8列（1年前期〜4年後期）ずつのブロック
LIST_BLOCKS = ["generalSelReq", "generalElective", "scienceDesignated", "scienceSelReq", "infoBasic", "required"]
for p in PROGRAMS:
    LIST_BLOCKS += [f"{p}.double", f"{p}.star", f"{p}.circle", f"{p}.other"]


def write_csv(courses, path):
    rows = []
    for c in courses:
        rows.append({
            "id": c["id"], "name": c["name"], "department": c["department"], "group": c["group"] or "",
            **{f"units.{k}": v for k, v in c["units"].items()},
            **{f"marks.{p}": m or "" for p, m in c["marks"].items()},
            "slot": "" if c["slot"] is None else c["slot"],
            "categories": " ".join(c["categories"]),
            "infoBasic": c["infoBasic"], "dsai": c["dsai"],
            "countsInRequiredShortage": c["countsInRequiredShortage"],
            "listing": " ".join(f"{l['category']}:{l['slot']}" for l in c["listing"]),
            "hidden": c["hidden"], "majorForStatus": c["majorForStatus"],
        })
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig: Excel で開いても文字化けしないように
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def read_excel_extra(path):
    """excel_extra.csv（Excel に無い科目）を、Excel から読んだ科目と同じ形にする。
    便覧の自由科目なので、プログラム指定・集計区分は空（卒業要件に数えない）"""
    out = []
    for r in csv.DictReader(open(path, encoding="utf-8-sig")):  # utf-8-sig：Excel で保存しても読めるように
        units = {k: 0 for k in ("required", "selReq", "elective", "free")}
        units[KIND_UNITS[r["kind"]]] = int(r["credits"])
        terms = r["terms"].split()
        c = {
            "id": r["id"], "name": r["name"], "department": r["dept"], "group": r["group"] or None,
            "units": units, "marks": {p: None for p in PROGRAMS},
            "slot": TERMS.index(terms[0]) if terms else None,
            "categories": [], "infoBasic": False, "dsai": False, "countsInRequiredShortage": False,
            "listing": [], "hidden": False, "majorForStatus": False,
            "extra": True,  # Excel に無く、excel_extra.csv から足した科目
        }
        # 入学年度で標準の学期が違うとき：「2023=2後」（年度=学期。複数は ; で区切る）
        if r.get("termsByYear"):
            c["termsByYear"] = {y: t.split() for y, t in (x.split("=") for x in r["termsByYear"].split(";"))}
        if r.get("note"):
            c["note"] = r["note"]
        out.append(c)
    return out


def insert_after_group(courses, c):
    """同じ部門・科目群の最後の科目のうしろに差し込む（一覧の見出しが分かれないように）"""
    at = max((i for i, x in enumerate(courses) if x["department"] == c["department"] and x["group"] == c["group"]),
             default=len(courses) - 1)
    courses.insert(at + 1, c)


def main():
    want_csv = "--csv" in sys.argv[1:]
    sys.argv = [a for a in sys.argv if a != "--csv"]
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else MATERIALS / "course_registration_plan.xlsx"
    if not src.exists():
        sys.exit(f"{src} がありません\n" + __doc__)
    wb = openpyxl.load_workbook(src)  # 数式のまま読む（計算結果の値は使わない）
    ws = wb["成績表"]

    # 一覧に出す行は、149行目の数式が実際に参照している行だけ（コース違いで参照されない行がある）
    listed = {}
    for b in range(len(LIST_BLOCKS)):
        for s in range(8):
            col = CI("BB") + b * 8 + s
            for row in re.findall(r"[A-Z]+(\d+)", str(ws.cell(149, col).value or "")):
                listed.setdefault(int(row), []).append((b, s))

    courses = []
    dept = group = None
    for r in range(6, 149):
        name = ws.cell(r, 3).value
        if ws.cell(r, 1).value:
            dept = str(ws.cell(r, 1).value).strip()
        if ws.cell(r, 2).value:
            group = str(ws.cell(r, 2).value).strip()
        if not name or ws.cell(r, 34).value is None:  # AH 列（単位数の計算）が無い行は見出し
            continue
        num = lambda c: int(ws.cell(r, c).value or 0)
        marks = {p: (str(ws.cell(r, 8 + i).value).strip() if ws.cell(r, 8 + i).value else None)
                 for i, p in enumerate(PROGRAMS)}
        courses.append({
            "id": f"r{r}",
            "name": str(name).strip(),
            "department": dept,
            "group": group,
            "units": {"required": num(4), "selReq": num(5), "elective": num(6), "free": num(7)},
            "marks": marks,
            # 標準履修学期：毎週授業時間数の列（L〜S = 1年前期〜4年後期）で、値のある最初の列
            "slot": next((i for i in range(8) if ws.cell(r, 12 + i).value is not None), None),
            "categories": [k for col, k in AGG.items() if ws[f"{col}{r}"].value is not None],
            "infoBasic": ws[f"AO{r}"].value is not None,
            "dsai": ws[f"AG{r}"].value is not None,
            "countsInRequiredShortage": r >= 77 and ws[f"AM{r}"].value is not None,
            "listing": [{"category": LIST_BLOCKS[b], "slot": s} for b, s in listed.get(r, [])],
            # Excel で非表示の行（総合コース用）
            "hidden": bool(ws.row_dimensions[r].hidden),
            # 成績概況の「専門修得単位」に数える行（73〜147行目）
            "majorForStatus": 73 <= r <= 147,
        })

    # Excel に無い科目（学生便覧の自由科目など）を excel_extra.csv から足す
    extra_path = DATA / "excel_extra.csv"
    if extra_path.exists():
        for c in read_excel_extra(extra_path):
            insert_after_group(courses, c)

    # 必要単位数（9 項目）：コースごと・プログラムごと
    #   advanced（先進プロジェクトコース）：各プログラムシートの B19:B27
    #   general（総合コース）：同じシートの O19:O27「総合コース用」。O が空の行は先進と同じ（B の値）
    #   （総合は専門必修 21→10、◎ 14→16、○ 15→20。先進プロジェクトの必修科目がない分、◎・○ が多い）
    def requirement(p, col):
        return [wb[p].cell(r, col).value if wb[p].cell(r, col).value is not None else wb[p].cell(r, 2).value
                for r in range(19, 28)]
    requirements = {
        "advanced": {p: requirement(p, 2) for p in PROGRAMS},
        "general": {p: requirement(p, 15) for p in PROGRAMS},
    }

    # 成績概況の基準（成績表 1595〜1597行目の数式から読む）
    status_rules = []
    for c in range(20, 30):
        per_grade = []
        for r in (1595, 1596, 1597):
            f = str(ws.cell(r, c).value)
            nums = [int(x) for x in re.findall(r">=(\d+)", f)]
            e = re.findall(r"<(\d+),5", f)
            per_grade.append({"thresholds": [nums[i:i + 2] for i in range(0, 6, 2)],
                              "eBelow": int(e[0]) if e else None})
        status_rules.append(per_grade)

    # 点数 → GP の換算表（成績表 R2032:S2132）
    gp_table = [[ws.cell(r, 18).value, ws.cell(r, 19).value] for r in range(2032, 2133)]

    entrance = ws["G1"].value
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DATA / f"excel_{entrance}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"courses": courses, "requirements": requirements, "gpTable": gp_table,
                   "statusRules": status_rules}, f, ensure_ascii=False, indent=1)
    print(f"{len(courses)} 科目 -> {out}")
    if want_csv:
        csv_out = DATA / f"excel_{entrance}.csv"
        write_csv(courses, csv_out)
        print(f"科目の一覧 -> {csv_out}")


if __name__ == "__main__":
    main()
