
const timetable = document.getElementById("timetable");

const days = ["月", "火", "水", "木", "金", "土"];
const periods = [1, 2, 3, 4, 5, 6];

if (timetable) {
  // ヘッダー
  for (const day of ["時限", ...days]) {
    const cell = document.createElement("div");
    cell.className = "cell header";
    cell.textContent = day;
    timetable.appendChild(cell);
  }

  // 時間割
  for (const period of periods) {
    const periodCell = document.createElement("div");
    periodCell.className = "cell header";
    periodCell.textContent = `${period}限`;
    timetable.appendChild(periodCell);

    for (const day of days) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell empty";
      cell.dataset.day = day;
      cell.dataset.period = String(period);
      cell.setAttribute("aria-label", `${day}曜${period}限`);

      //各セルのクリックイベントを設定
      cell.addEventListener("click", () => {
        document.querySelectorAll(".cell.selected").forEach((selected) => {
          selected.classList.remove("selected");
        });

        cell.classList.add("selected");
        console.log(`${day}曜${period}限を選択`);
      });

      timetable.appendChild(cell);
    }
  }
}

// HTMLの要素を取得
const menuButton = document.getElementById("menuButton");
const closeButton = document.getElementById("closeButton");
const sidebar = document.getElementById("sidebar");

// サイドバーの状態を変更する
function setMenuState(isOpen) {

    if (isOpen) {

        // サイドバーを表示
        sidebar.classList.add("active");

        // メイン画面を縮小
        document.body.classList.add("menu-open");

    } else {

        // サイドバーを非表示
        sidebar.classList.remove("active");

        // メイン画面を元に戻す
        document.body.classList.remove("menu-open");

    }

    // アクセシビリティ用の状態を更新
    menuButton.setAttribute("aria-expanded", String(isOpen));

    sidebar.setAttribute("aria-hidden", String(!isOpen));
}


// メニューボタンを押したとき
if (menuButton && closeButton && sidebar) {

    menuButton.addEventListener("click", function () {

        // 開いている場合は閉じる
        const isOpen = sidebar.classList.contains("active");

        setMenuState(!isOpen);

    });


    // 閉じるボタンを押したとき
    closeButton.addEventListener("click", function () {

        setMenuState(false);

    });


    // Escapeキーを押したとき
    document.addEventListener("keydown", function (event) {

        if (event.key === "Escape") {

            setMenuState(false);

        }

    });

}
