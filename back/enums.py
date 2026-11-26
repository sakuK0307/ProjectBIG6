"""DBなどで使う列挙型の定義"""
from enum import IntEnum, Enum

# ========================================
# コース
# ========================================
class CourseType(Enum):
    """総合コースと先進プロジェクトコースのenum"""
    GENERAL = "general"       # 総合コース
    """総合"""
    ADVANCED = "advanced"     # 先進プロジェクトコース
    """先進"""


# ========================================
# プログラム
# ========================================
class Program(Enum):
    """PC,DE,HM,NSの4プログラム"""
    PC = "pc"      # フィジカルコンピューティング
    DE = "de"      # データエンジニアリング
    HM = "hm"      # ヒューマン・メディア
    NS = "ns"      # ネットワークシステム


class CreditType(Enum):
    """必修・選択必修などの区分"""
    REQUIRED = "required"
    """必修"""
    REQUIRED_ELECTIVE = "required_elective"
    """選択必修"""
    ELECTIVE = "elective"
    """選択"""
    FREE = "free"
    """なし"""

class ProgramDesignation(Enum):
    """プログラム欄の〇・◎などの区分"""
    REQUIRED = "required"          # プログラム欄の「必修」
    """プログラムでの必修"""
    DOUBLE_CIRCLE = "double_circle"  # ◎
    """◎"""
    REFERENCE = "reference"        # ※
    """※"""
    CIRCLE = "circle"              # ○
    """〇"""
    NONE = "none"                  # 空欄
    """空欄"""


# ========================================
# 学期
# ========================================
class Semester(IntEnum):
    """前期と後期"""
    FIRST = 0   # 前期
    """前期"""
    SECOND = 1  # 後期
    """後期"""


# ========================================
# 曜日
# ========================================
class Weekday(IntEnum):
    """一週間"""
    MONDAY = 0
    TUESDAY = 1
    WEDNESDAY = 2
    THURSDAY = 3
    FRIDAY = 4
    SATURDAY = 5
    SUNDAY = 6


# ========================================
# 隔週区分
# ========================================
class Parity(IntEnum):
    """隔週の種類"""
    NONE = 0  
    """毎週"""
    ODD = 1   # 奇数週
    """奇数週"""
    EVEN = 2  # 偶数週
    """偶数週"""

class CurriculumArea(Enum):
    """科目の部門"""
    GENERAL_FOUNDATION = "general_foundation"
    """総合基礎部門"""
    PROFESSIONAL_EDUCATION = "professional_education"
    """専門教育部門"""