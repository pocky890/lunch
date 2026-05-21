// 午餐大樂透 — 備援開獎 script（GitHub Actions 用）
// 在截止時間後若無人開頁面，由此 script 補跑開獎並送通知

const FIREBASE_BASE = "https://launch-fdd3a-default-rtdb.firebaseio.com/lunch";
const WEBHOOK_URL = process.env.WEBHOOK_URL;

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_BASE}/${path}.json`);
  return res.json();
}

async function fbSet(path, value) {
  await fetch(`${FIREBASE_BASE}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

function todayStr() {
  // GitHub Actions 跑在 UTC，轉換成台灣時間 (UTC+8)
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${tw.getUTCFullYear()}-${String(tw.getUTCMonth()+1).padStart(2,"0")}-${String(tw.getUTCDate()).padStart(2,"0")}`;
}

function isDeadlinePassed(deadline) {
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const [h, m] = deadline.split(":").map(Number);
  return tw.getUTCHours() > h || (tw.getUTCHours() === h && tw.getUTCMinutes() >= m);
}

function determineResult(pts, drawnNumber) {
  if (!pts || pts.length === 0) return null;
  const exact = pts.find(p => p.number === drawnNumber);
  if (exact) return { winner: exact, soloWin: true };

  const sorted = [...pts].sort((a, b) => Math.abs(a.number - drawnNumber) - Math.abs(b.number - drawnNumber));
  const minDiff = Math.abs(sorted[0].number - drawnNumber);
  const tied = sorted.filter(p => Math.abs(p.number - drawnNumber) === minDiff);
  return { winner: tied[drawnNumber % tied.length], soloWin: false };
}

async function main() {
  const today = todayStr();
  console.log(`[lunch-draw] date=${today}`);

  // 1. 讀取今日 session
  const session = await fbGet("session");
  if (!session)                    { console.log("No session, skip"); return; }
  if (session.date !== today)      { console.log(`Session date ${session.date} != ${today}, skip`); return; }
  if (!isDeadlinePassed(session.deadline)) { console.log("Deadline not passed yet, skip"); return; }

  // 2. 已有結果？（瀏覽器已處理，不重複送）
  const existing = await fbGet(`weekly/${today}`);
  if (existing) { console.log("Result already exists, skip"); return; }

  // 3. 讀取參加者
  const ptsObj = await fbGet("participants");
  const pts = Object.values(ptsObj || {}).sort((a, b) => a.joinedAt - b.joinedAt);
  if (pts.length < 2) { console.log(`Only ${pts.length} participant(s), skip`); return; }

  // 4. 抽號（已有就沿用）
  const numMax = session.numMax || 99;
  let drawnNumber = await fbGet(`drawn/${today}`);
  if (!drawnNumber) {
    drawnNumber = Math.floor(Math.random() * numMax) + 1;
    await fbSet(`drawn/${today}`, drawnNumber);
    console.log(`Drew number: ${drawnNumber}`);
  } else {
    console.log(`Using existing drawn number: ${drawnNumber}`);
  }

  // 5. 計算結果
  const result = determineResult(pts, drawnNumber);
  if (!result) { console.log("No result, skip"); return; }

  // 6. 再次確認 weekly 沒被瀏覽器搶先寫入
  const doubleCheck = await fbGet(`weekly/${today}`);
  if (doubleCheck) { console.log("Browser just wrote the result, skip"); return; }

  // 7. 寫入 weekly
  const rec = { winner: result.winner.name, rest: result.winner.rest, soloWin: result.soloWin, drawnNumber };
  await fbSet(`weekly/${today}`, rec);
  console.log(`Written weekly/${today}:`, rec);

  // 8. 讀取不參加名單
  const absentObj = await fbGet("absent");
  const absentNames = Object.values(absentObj || {}).map(v => typeof v === "object" ? v.name : v);

  // 9. 送通知
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      winner:       result.winner.name,
      winnerNumber: result.winner.number,
      rest:         result.winner.rest,
      drawnNumber,
      soloWin:      result.soloWin ? 1 : 0,
      totalPeople:  pts.length,
      participants: pts.map(p => p.name).join(", "),
      absent:       absentNames.join(", "),
    }),
  });
  console.log(`Webhook sent: ${res.status}`);
}

main().catch(err => { console.error(err); process.exit(1); });
