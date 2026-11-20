"""科目データ JSON（build_course_data.py の出力）を、履修リスト画面が読む JS にする

使い方（リポジトリ直下で）:
    python scripts/course_to_js.py [入力 JSON] [出力 JS]

    入力の初期値: scripts/data/course.json
    出力の初期値: static/js/course-data.js（templates/list.html が <script> で読む）

<script> で読む JS にしておくと、HTML をダブルクリックで開いても動く（file:// だと fetch で JSON を読めないため）。
course-data.js は自動で作るファイルなので、手で編集しない。
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "data" / "course.json"
out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE.parent / "static" / "js" / "course-data.js"

def rel(path):
    """リポジトリ直下からのパス（記録用。リポジトリの外なら名前だけ）"""
    try:
        return path.resolve().relative_to(HERE.parent).as_posix()
    except ValueError:
        return path.name


data = json.load(open(src, encoding="utf-8"))
js = (
    "// 自動生成ファイル（手で編集しない）: python scripts/course_to_js.py\n"
    f"// 元データ: {rel(src)}（← {', '.join(data.get('source', []))}）\n"
    f"window.LIST_YEAR = {json.dumps(data['year'])};\n"
    f"window.LIST_REQUIREMENTS = {json.dumps(data['requirements'], ensure_ascii=False)};\n"
    f"window.LIST_COURSES = {json.dumps(data['courses'], ensure_ascii=False, indent=1)};\n"
)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(js, encoding="utf-8")
print(f"{len(data['courses'])} 科目 -> {out}")
