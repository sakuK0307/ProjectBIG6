// 履修リスト画面とサーバーのやり取り（API の約束は test/mock_api/list_mock.py の先頭に書いてある）
// URL や送り方を知っているのはこのファイルだけ。list.js はここの ListApi を import して呼ぶだけなので、
// サーバーがモック（test/mock_api/list_mock.py）から本物に変わっても、HTML・JS は変えなくてよい

// 画面と同じサーバーの /api/... に送る（Flask で開く前提）
const BASE = "";
// これ以上待っても返事が来なければあきらめる（サーバーが固まっても画面が待ち続けないように）
const TIMEOUT_MS = 10000;

async function request(method, path, body) {
  // AbortController：時間切れになったら fetch を途中で止めるための道具
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    // 時間切れ（AbortError）は、分かる文にして投げ直す。それ以外（つながらない など）はそのまま
    throw e.name === "AbortError" ? new Error(`${method} ${path} の返事が ${TIMEOUT_MS / 1000} 秒来ませんでした`) : e;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `${method} ${path} が ${res.status} で失敗しました`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

// 保存は変えるたびに呼ばれるので、送っている途中に次が来たら、終わってから最新のものだけ送る
let sending = null;
let pending = null;
async function flush() {
  while (pending) {
    const body = pending;
    pending = null;
    try {
      await request("PUT", "/api/plan", body);
    } catch (e) {
      console.error("履修計画を保存できませんでした", e);
      // 画面（list.js）に知らせる。list.js はこれを受け取ってトーストを出す
      window.dispatchEvent(new CustomEvent("listapi:save-error", { detail: e }));
    }
  }
  sending = null;
}

export const ListApi = {
  // GET /api/courses → { timetableYear, rules, courses }（rules に必要単位数 requirements も入っている）
  getCourses: () => request("GET", "/api/courses"),
  // GET /api/plan → { term, entrance, courseType, plan }
  getPlan: () => request("GET", "/api/plan"),
  // PUT /api/plan（返事を待たずに次の操作ができるように、送るのは裏で行う）
  savePlan(state) {
    pending = state;
    sending ||= flush();
    return sending;
  },
};
