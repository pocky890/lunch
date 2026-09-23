// 午餐大樂透 — 未決定名單提醒 script（GitHub Actions 用）
// 截止前檢查誰還沒按參加/不參加，指名道姓送 n8n 通知

const FIREBASE_BASE = "https://launch-fdd3a-default-rtdb.firebaseio.com/lunch";
const WEBHOOK_URL = process.env.WEBHOOK_URL;

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_BASE}/${path}.json`);
  return res.json();
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

async function main() {
  const today = todayStr();
  console.log(`[lunch-remind] date=${today}`);

  const session = await fbGet("session");
  if (!session)                            { console.log("No session, skip"); return; }
  if (session.date !== today)              { console.log(`Session date ${session.date} != ${today}, skip`); return; }
  if (isDeadlinePassed(session.deadline))   { console.log("Deadline already passed, skip"); return; }

  const [userNames, userStatus, ptsObj, absentObj] = await Promise.all([
    fbGet("userNames"), fbGet("userStatus"), fbGet("participants"), fbGet("absent"),
  ]);

  // 名單 = 所有已綁定帳號的人，扣掉標記離職的
  const roster = Object.entries(userNames || {})
    .filter(([uid]) => (userStatus || {})[uid] !== "resigned")
    .map(([, name]) => name);

  const decided = new Set([
    ...Object.values(ptsObj || {}).map(p => p.name),
    ...Object.values(absentObj || {}).map(v => (typeof v === "object" ? v.name : v)),
  ]);

  const undecided = roster.filter(name => !decided.has(name));
  if (undecided.length === 0) { console.log("Everyone has decided, skip"); return; }

  console.log(`Undecided: ${undecided.join(", ")}`);
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reminder: 1,
      undecidedNames: undecided.join("、"),
      undecidedCount: undecided.length,
      deadline: session.deadline,
    }),
  });
  console.log(`Webhook sent: ${res.status}`);
}

main().catch(err => { console.error(err); process.exit(1); });
