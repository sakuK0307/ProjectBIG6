# 講義情報API v3（1テーブル版）

## 設計
講義情報と時間割情報を1つの `lectures` テーブルに統合しています。
1行を「特定の学年・クラス・学期・曜日・時限に開講される1つの講義枠」として扱います。

`id` は開講枠ごとの内部IDです。同じ科目でも、担当教員・再履修・クラス・学期などが異なる場合は別の `id` を割り当てます。
`course_code` は人間が管理する科目コードで、同じ科目の別開講枠で重複しても構いません。

## ファイル
- lectures.csv: 人間が編集する元データ
- schema.sql: SQLiteテーブル定義
- import_csv.py: CSVからDBを再構築する処理
- lectures.db: 作成済みデータベース
- app.py: Flask API

## CSV編集とDB変換
CSVを編集して保存した後、次を実行します。

```bash
python import_csv.py
```

このスクリプトはDBを削除してCSVから作り直します。CSVにない古い行が残りません。
CSVの `id` は各行で一意にしてください。新しい行を追加するときは未使用のIDを割り当ててください。

## Flask起動
```bash
pip install flask
python app.py
```

## 時間割検索
```text
http://127.0.0.1:5000/lectures?grade=2&class_group=A&semester=前期&day=1&period=3
```

## IDで1行取得
```text
http://127.0.0.1:5000/lectures/4
```

曜日: 月=1、火=2、水=3、木=4、金=5
学期: 前期 / 後期
クラス区分の例: A / B / 再履修
