"""db初期化など"""

from flask_sqlalchemy import SQLAlchemy

db=SQLAlchemy()

is_db_inited=False

def init_db(app):
    """データベースをセットアップします。"""
    global is_db_inited
    if is_db_inited:
        return
    is_db_inited=True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///myclassplan.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    from back.models import model as _models

    with app.app_context():
        db.create_all()



