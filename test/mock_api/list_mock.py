"""履修リスト画面のモック API（Flask）

使い方（リポジトリ直下で）:
    python test/mock_api/list_mock.py   → http://localhost:5002/（5001 は test/mini_list が使う）

画面（templates/list.html・css・js）をそのまま配信し、/api/... に決まったデータを返す。
本物のサーバーも下の「API の約束」と同じ URL・同じ形で作れば、HTML・JS は変えなくてよい。

API の約束（画面側は templates/js/list-api.js から呼ぶ）:
    GET /api/courses  → { timetableYear, rules, courses }   科目データ（scripts/data/course.json から meta を外したもの）
                         timetableYear：時間割表の年度（開講クラス・シラバスのリンクがいつのものか。入学年度とは別）
                         rules：判定の決まりごと
                           requirements：必要単位数 { advanced: { PC: [9 個], … }, general: { … } }（先進・総合コース）
                           notCounted・judgments：数えない科目・進級などの条件（scripts/data/rules.json）
                         courses の各科目の courseType："both"・"advanced"（先進だけ）・"general"（総合だけ）
    GET /api/plan     → { term, entrance, courseType, plan }   保存してある履修計画（なければ plan が空）
    PUT /api/plan     ← { term, entrance, courseType, plan }   履修計画を丸ごと保存して、同じものを返す
                         形がおかしければ 400 { error, details: [...] }

    plan の中身：{ 科目 id: { attempts: [{ term: "1前", score: 85 または null }], code?: "641101" } }
    term は 1前〜4後、entrance は 2023〜2026、courseType は advanced（先進）か general（総合）、score は 0〜100 か null（予定）

履修計画はメモリに置くだけ（止めると消える）。
"""
import json
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FRONT = ROOT / "templates"                      # 画面のファイル（Jinja は使わないので、そのまま配信する）

# templates/ の中身を URL のいちばん上から配信する（/css/list.css、/js/list.js など）
app = Flask(__name__, static_folder=FRONT, static_url_path="")

TERMS = ["1前", "1後", "2前", "2後", "3前", "3後", "4前", "4後"]
ENTRANCE_YEARS = [2023, 2024, 2025, 2026]
COURSE_TYPES = ["advanced", "general"]

# ---- データ ----
# 科目データは scripts が作った course.json を使う（meta は何から作ったかの記録なので外す）
catalog = json.loads((ROOT / "scripts" / "data" / "course.json").read_text(encoding="utf-8"))
catalog.pop("meta", None)

# 履修計画（メモリに置くだけ）
plan_state = {"term": "3前", "entrance": 2025, "courseType": "advanced", "plan": {}}


def plan_problems(body):
    """送られてきた履修計画のおかしいところを、読める文にして返す（なければ空）"""
    if not isinstance(body, dict):
        return ["JSON のオブジェクトを送ってください"]
    errs = []
    for key in ("term", "entrance", "courseType", "plan"):
        if key not in body:
            errs.append(f"{key} がありません")
    if "term" in body and body["term"] not in TERMS:
        errs.append(f"term: {body['term']!r} は 1前〜4後 のどれでもありません")
    if "entrance" in body and body["entrance"] not in ENTRANCE_YEARS:
        errs.append(f"entrance: {body['entrance']!r} は 2023〜2026 のどれでもありません")
    if "courseType" in body and body["courseType"] not in COURSE_TYPES:
        errs.append(f"courseType: {body['courseType']!r} は advanced か general にしてください")
    plan = body.get("plan", {})
    if not isinstance(plan, dict):
        return errs + ["plan はオブジェクトにしてください"]
    for cid, entry in plan.items():
        attempts = entry.get("attempts") if isinstance(entry, dict) else None
        if not isinstance(attempts, list) or not attempts:
            errs.append(f"plan/{cid}: attempts（1 回以上）がありません")
            continue
        for i, a in enumerate(attempts):
            where = f"plan/{cid}/attempts/{i}"
            if not isinstance(a, dict):
                errs.append(f"{where}: オブジェクトにしてください")
                continue
            if a.get("term") not in TERMS:
                errs.append(f"{where}/term: {a.get('term')!r} は 1前〜4後 のどれでもありません")
            score = a.get("score")
            if score is not None and not (isinstance(score, int) and not isinstance(score, bool) and 0 <= score <= 100):
                errs.append(f"{where}/score: {score!r} は 0〜100 の整数か null にしてください")
    return errs


# ---- 画面 ----
@app.get("/")
def page():
    return send_from_directory(FRONT, "list.html")


# ---- API ----
@app.get("/api/courses")
def get_courses():
    return jsonify(catalog)

@app.get("/api/plan")
def get_plan():
    return jsonify(plan_state)

@app.put("/api/plan")
def put_plan():
    body = request.get_json(silent=True)
    if errs := plan_problems(body):
        print("[モック] PUT /api/plan の中身がおかしいので保存しません:", *errs[:5], sep="\n  ")
        return jsonify({"error": "履修計画の形がおかしいので保存しませんでした", "details": errs[:20]}), 400
    plan_state.clear()
    plan_state.update(body)
    return jsonify(plan_state)


if __name__ == "__main__":
    app.run(debug=True, host="localhost", port=5002)
