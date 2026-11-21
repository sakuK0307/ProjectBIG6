# scripts（科目データの作り直し）

Excel・時間割表 PDF などから、履修リスト画面がサーバー（`/api/courses`）から受け取る科目データ `data/course.json` を作る。
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
```

| スクリプト | 入力 | 出力 |
|---|---|---|
| `excel_to_json.py` | `materials/course_registration_plan.xlsx`、`data/excel_extra.csv` | `data/excel_<入学年度>.json`（科目・単位・区分・必要単位数） |
| `timetable_to_json.py` | `materials/*info_eng01.pdf`、`data/excel_*.json`、`data/timetable_extra.csv` | `data/timetable_<年度>.json`（開講クラス） |
| `build_course_data.py` | `data/excel_*.json`、`data/timetable_*.json`、`data/rules.json` | `data/course.json`（画面用の科目データ） |

- `--csv` を付けると、Excel で確かめる用の CSV も `data/` に書き出す。
- 引数でファイルを指定することもできる。詳しくは各スクリプトの先頭の説明を参照。

## フォルダ
- `materials/`：元の資料。git には入れていないので、各自で用意して置く
  - `course_registration_plan.xlsx`（卒業判定 Excel。成績の入っていないもの）
  - `<年度>info_eng01.pdf`（授業時間割表）
- `data/`：できあがったデータ。次の 3 つだけは手で書く
  - `rules.json`：判定の決まりごと。`build_course_data.py` が `course.json` の `rules` に入れ、画面（`templates/js/list-rules.js`）が使う
    - `advancedOnly`：先進コースだけの科目のうち、卒業判定 Excel から分からないものの ID（今は先進プロジェクト実験Ⅱ・先進プロジェクトゼミナール）。
      科目ごとの `courseType`（`both`・`advanced`・`general`）を決めるのに使い、`course.json` の `rules` には入れない。
      Excel で非表示の行は `general`、総合用と同じ名前の行は `advanced` に自動で決まる
    - `notCounted`：入学年度の決まりで卒業要件に数えない科目（例：2023 年度入学・先進の「情報技術の応用と職業」）
    - `judgments`：進級・研究ゼミ・卒研着手・DS・AI の条件の数と、いつまでの分で数えるか（`upto`）
    - 便覧が変わったらここを直して `build_course_data.py` を実行し直す（JS は直さなくてよい）
  - `excel_extra.csv`：学生便覧にあって卒業判定 Excel に無い科目（数学基礎演習などの自由科目）。`excel_to_json.py` だけが読み、Excel の科目と一緒に `excel_*.json` に入れる。
    列は `id,name,dept,group,kind,credits,terms,termsByYear,note`。`termsByYear` は入学年度で標準の学期が違うとき（例：`2023=2後`）。
    `id` は保存済みの履修計画とつながるので、一度決めたら変えない
  - `timetable_extra.csv`：PDF から読み取れない講義コード

## 注意
- `data/*.json` は自動で作るファイルなので、手で編集しない（手で書くのは上の 3 つだけ）。
