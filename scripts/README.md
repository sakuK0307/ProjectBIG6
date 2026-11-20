# scripts（科目データの作り直し）

Excel・時間割表 PDF から、履修リスト画面（`templates/list.html`）が読む `static/js/course-data.js` を作る。
アプリを動かすだけなら不要。Excel や時間割表が新しくなったときに使う。

## 準備（初回のみ）
```cmd
python -m pip install -r scripts/requirements.txt
```

## 作り直す（リポジトリ直下で、上から順に）
```cmd
python scripts/excel_to_json.py
python scripts/timetable_to_json.py
python scripts/build_course_data.py
python scripts/course_to_js.py
```

| スクリプト | 入力 | 出力 |
|---|---|---|
| `excel_to_json.py` | `materials/course_registration_plan.xlsx` | `data/excel_<入学年度>.json`（科目・単位・区分・必要単位数） |
| `timetable_to_json.py` | `materials/*info_eng01.pdf`、`data/excel_*.json`、`data/timetable_extra.csv` | `data/timetable_<年度>.json`（開講クラス） |
| `build_course_data.py` | `data/excel_*.json`、`data/timetable_*.json` | `data/course.json`（画面用の科目データ） |
| `course_to_js.py` | `data/course.json` | `static/js/course-data.js` |

- `--csv` を付けると（`course_to_js.py` 以外）、Excel で確かめる用の CSV も `data/` に書き出す。
- 引数でファイルを指定することもできる。詳しくは各スクリプトの先頭の説明を参照。

## フォルダ
- `materials/`：元の資料。git には入れていないので、各自で用意して置く
  - `course_registration_plan.xlsx`（卒業判定 Excel。成績の入っていないもの）
  - `<年度>info_eng01.pdf`（授業時間割表）
- `data/`：できあがったデータ。`timetable_extra.csv` だけは手で書く（PDF から読み取れない講義コード）

## 注意
- `data/*.json` と `static/js/course-data.js` は自動で作るファイルなので、手で編集しない。
