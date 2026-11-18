
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
