from flask import Flask;

app=Flask(__name__)

@app.route("/hello")
def get_hello():
    return "hello!"

if(__name__=="__main__"):
    # ローカルホスト 5000ポートで実行
    app.run(debug=True,host="localhost",port=5000)