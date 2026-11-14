# セットアップ方法

## venvのセットアップ

1. (初回のみ)`/back`ディレクトリで以下のコマンド

```cmd
python -m venv .venv
```

2. (**毎回**)`venv`に入る
`.venv\Scripts`にある`activate.bat`を実行する
```cmd
.venv\Scripts\activate.bat
```
実行後コマンドプロンプトの入力場所の先頭に`(.venv)`と出る

## 今あるやつ全部導入
(初回、新しいモジュールを導入したとき、モジュール読み込みエラーが出るとき)  
`.venv`に入って以下を実行
```cmd
python -m pip install -r requirements.txt
```
`requirements.txt`に記載されている通りに導入します。

## `requirements.txt`の更新
(新しいモジュールを導入したとき)
`.venv`に入って以下を実行
```cmd
python -m pip freeze > requirements.txt
```