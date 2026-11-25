from flask import Flask, request;

app=Flask(__name__)

@app.route("/hello")
def get_hello():
    """疎通確認用API"""
    return "hello!"

@app.route("/api/courses", methods=["GET"])
def get_courses():
    """"""
    return """
{
  "timetableYear": 2026,
  "rules": {
    "requirements": {
      "advanced": {
        "PC": [10, 20, 8, 12, 21, 14, 9, 15, 104],
        "DE": [],
        "HM": [],
        "NS": []
      },
      "general": {
        "PC": [10, 20, 8, 12, 10, 16, 9, 20, 104],
        "DE": [],
        "HM": [],
        "NS": []
      }
    },
    "notCounted": [],
    "judgments": {}
  },
  "courses": [
    {
      "id": "r6",
      "name": "英語コミュニケーションⅠ",
      "dept": "総合基礎部門",
      "group": "",
      "kind": "選必",
      "credits": 1,
      "terms": ["1前"],
      "prog": {
        "PC": "",
        "DE": "",
        "HM": "",
        "NS": ""
      },
      "req": ["総選", "総計"],
      "hidden": false,
      "courseType": "both",
      "dsai": false,
      "offers": []
    }
  ]
}""", 500


@app.route("/api/plan", methods=["GET"])
def get_plan():
    return """
{
  "term": "3前",
  "entrance": 2025,
  "courseType": "advanced",
  "plan": {
    "r6": {
      "attempts": [
        {
          "term": "1前",
          "score": 85
        }
      ]
    },
    "r7": {
      "attempts": [
        {
          "term": "1後",
          "score": 45
        },
        {
          "term": "2後",
          "score": null
        }
      ],
      "code": "641201"
    }
  }
}
""",500


@app.route("/api/plan", methods=["PUT"])
def update_plan():
    data=request.json()
    return """
{
  "term": "3前",
  "entrance": 2025,
  "courseType": "advanced",
  "plan": {
    "r6": {
      "attempts": [
        {
          "term": "1前",
          "score": 85
        }
      ]
    },
    "r7": {
      "attempts": [
        {
          "term": "1後",
          "score": 45
        },
        {
          "term": "2後",
          "score": null
        }
      ],
      "code": "641201"
    }
  }
}"""

if(__name__=="__main__"):
    # ローカルホスト 5000ポートで実行
    app.run(debug=True,host="localhost",port=5000)