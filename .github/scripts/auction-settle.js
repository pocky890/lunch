// 午餐大樂透 — 地雷卡拍賣結算 script（GitHub Actions 用，由 n8n 準時 workflow_dispatch 觸發）
// 截標後：依出價高低扣點、發卡給得標者、寫入結果，並建立下一場拍賣（每週五 09:00 開標、12:00 截標，遇假日往前找上班日）

const { isWorkday } = require("./calendar");

const FIREBASE_BASE = process.env.FIREBASE_BASE || "https://launch-fdd3a-default-rtdb.firebaseio.com/lunch";
const WEBHOOK_URL = process.env.AUCTION_WEBHOOK_URL;
const TZ_MS = 8 * 3600000;
const pad = n => String(n).padStart(2, "0");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sanitizeKey(str) { return str.replace(/[.#$/[\]]/g, "_"); }

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_BASE}/${path}.json`);
  return res.json();
}
async function fbSet(path, value) {
  const res = await fetch(`${FIREBASE_BASE}/${path}.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
}
async function fbPost(path, value) {
  const res = await fetch(`${FIREBASE_BASE}/${path}.json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
}
async function fbGetWithEtag(path) {
  const res = await fetch(`${FIREBASE_BASE}/${path}.json`, { headers: { "X-Firebase-ETag": "true" } });
  return { value: await res.json(), etag: res.headers.get("ETag") };
}
// 條件寫入：僅當 ETag 仍相符才寫入。回傳 true = 寫入成功；false = 已被搶先（412）
async function fbSetIfMatch(path, value, etag) {
  const res = await fetch(`${FIREBASE_BASE}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "if-match": etag },
    body: JSON.stringify(value),
  });
  if (res.status === 200) return true;
  if (res.status === 412) return false;
  throw new Error(`conditional PUT ${path} failed: ${res.status}`);
}

function taipeiMs(y, m, d, hh, mm) { return Date.UTC(y, m - 1, d, hh - 8, mm); }
function dayStr(day) { return `${day.y}-${pad(day.m)}-${pad(day.d)}`; }
function todayStr() { const tw = new Date(Date.now() + TZ_MS); return dayStr({ y: tw.getUTCFullYear(), m: tw.getUTCMonth() + 1, d: tw.getUTCDate() }); }

// 下一場拍賣：afterMs 之後第一個「開標時間晚於 afterMs」的週五；週五遇假日就往前找最近的上班日
function nextAuctionAfter(afterMs) {
  const tw = new Date(afterMs + TZ_MS);
  let dt = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()));
  for (let i = 0; i < 60; i++, dt = new Date(dt.getTime() + 86400000)) {
    if (dt.getUTCDay() !== 5) continue;
    let d = new Date(dt.getTime());
    while (!isWorkday(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())) d = new Date(d.getTime() - 86400000);
    const day = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
    const openAt = taipeiMs(day.y, day.m, day.d, 9, 0);
    if (openAt > afterMs) return { day, openAt, closeAt: taipeiMs(day.y, day.m, day.d, 12, 0) };
  }
  throw new Error("找不到下一場拍賣日");
}

// 得標的卡可用到「下一場拍賣日」，剛好涵蓋整個工作週（含那天 11:45 的開獎）
function buildAuction(afterMs) {
  const a = nextAuctionAfter(afterMs);
  const following = nextAuctionAfter(a.closeAt);
  return {
    id: dayStr(a.day), cardType: "mine_card", openAt: a.openAt, closeAt: a.closeAt, hardCloseAt: a.closeAt + 10 * 60000,
    minBid: 100, step: 10, cardExpiresAt: dayStr(following.day), top: null,
  };
}

async function deductPoints(key, amount) {
  for (let i = 0; i < 5; i++) {
    const { value, etag } = await fbGetWithEtag(`userPoints/${key}`);
    if ((value || 0) < amount) return false;
    if (await fbSetIfMatch(`userPoints/${key}`, value - amount, etag)) return true;
  }
  return false;
}

async function main() {
  let cur = await fbGet("auction/current");
  if (!cur) { console.log("No auction, skip"); return; }

  // 截標前 1 分鐘內有人出價會延長截標，所以在 15 分鐘內就等到真正截標，更久則放棄這次
  for (;;) {
    const now = Date.now();
    if (now >= cur.closeAt) break;
    if (cur.closeAt - now > 15 * 60000) { console.log(`Auction ${cur.id} not closed yet, skip`); return; }
    await sleep(Math.min(cur.closeAt - now + 1500, 60000));
    const fresh = await fbGet("auction/current");
    if (!fresh || fresh.id !== cur.id) { console.log("Auction changed meanwhile, skip"); return; }
    cur = fresh;
  }

  // 搶占結算權；若上一次結算中途失敗（processing 超過 3 分鐘沒動靜）就接手續做，每個步驟都有進度標記避免重複扣點/發卡
  const claimPath = `auction/settled/${cur.id}`;
  const { value: claimed, etag } = await fbGetWithEtag(claimPath);
  let state = { status: "processing", ts: Date.now() };
  if (claimed !== null) {
    if (claimed.status === "done" || Date.now() - claimed.ts < 3 * 60000) { console.log(`Auction ${cur.id} already settled/processing (${claimed.status}), skip`); return; }
    console.log("Resuming stale settlement:", claimed);
    state = { ...claimed, ts: Date.now() };
  }
  if (!(await fbSetIfMatch(claimPath, state, etag))) { console.log("Lost race to settle, skip"); return; }
  const save = async patch => { state = { ...state, ...patch, ts: Date.now() }; await fbSet(claimPath, state); };

  const today = todayStr();
  if (!state.paid) {
    // 出價名單（每人最後一筆）；top 為準，避免出價者在寫入 bids 前就斷線造成金額落後
    const bids = (await fbGet(`auction/bids/${cur.id}`)) || {};
    const byName = new Map();
    for (const b of Object.values(bids)) if (b && b.name && b.amount >= cur.minBid) byName.set(b.name, b);
    if (cur.top && (!byName.has(cur.top.name) || byName.get(cur.top.name).amount < cur.top.amount)) byName.set(cur.top.name, { name: cur.top.name, amount: cur.top.amount, ts: cur.top.ts });
    const list = [...byName.values()].sort((a, b) => b.amount - a.amount || a.ts - b.ts);
    let winner = null;
    const unpaid = [];
    for (const b of list) {
      if (await deductPoints(sanitizeKey(b.name), b.amount)) { winner = b; break; }
      unpaid.push({ name: b.name, amount: b.amount });
    }
    await save({ paid: true, winner: winner ? winner.name : null, price: winner ? winner.amount : null, unpaid, bidders: list.length });
  }

  const now = Date.now();
  if (state.winner && !state.minted) {
    const key = sanitizeKey(state.winner);
    await fbPost(`userCards/${key}`, { type: cur.cardType, expiresAt: cur.cardExpiresAt, obtainedAt: today, fromShop: true, fromAuction: true });
    await fbPost(`pointsLog/${key}`, { type: "auction", delta: -state.price, note: `地雷卡拍賣 ${cur.id}`, ts: now });
    await fbPost(`userNotifications/${key}`, { type: "auction_won", price: state.price, expiresAt: cur.cardExpiresAt, date: today, ts: now });
    await save({ minted: true });
  }
  if (!state.notified) {
    for (const u of state.unpaid || []) await fbPost(`userNotifications/${sanitizeKey(u.name)}`, { type: "auction_unpaid", price: u.amount, date: today, ts: now });
    await save({ notified: true });
  }

  const result = { id: cur.id, winner: state.winner || null, price: state.price || null, bidders: state.bidders || 0, ts: now };
  await fbSet("auction/lastResult", result);
  const latest = await fbGet("auction/current");
  const next = buildAuction(cur.closeAt);
  if (latest && latest.id === cur.id) await fbSet("auction/current", next);
  await save({ status: "done" });
  console.log("Settled:", result, "Next:", next.id, new Date(next.openAt).toISOString());

  if (WEBHOOK_URL) {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auction: 1,
        auctionWinner: result.winner || "",
        auctionPrice: result.price || 0,
        auctionBidders: result.bidders,
        auctionExpires: cur.cardExpiresAt,
        auctionNext: next.id,
      }),
    });
    console.log(`Webhook sent: ${res.status}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
