// 午餐大樂透 — 備援開獎 script（GitHub Actions 用）
// 在截止時間後若無人開頁面，由此 script 補跑開獎並送通知

const FIREBASE_BASE = "https://launch-fdd3a-default-rtdb.firebaseio.com/lunch";
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const CARD_TYPES = {
  follow_restaurant: { name:"跟著我吃卡" },
  extra_number:      { name:"加號卡" },
  streak_protect:    { name:"連勝保護卡" },
  reveal_numbers:    { name:"公開卡" },
  steal_card:        { name:"盜牌卡" },
  cheapskate_card:   { name:"免付卡" },
};
const CARD_DEFAULTS = {
  follow_restaurant: { expireDays:30 },
  extra_number:      { expireDays:30 },
  streak_protect:    { expireDays:90 },
  reveal_numbers:    { expireDays:60 },
  steal_card:        { expireDays:30 },
  cheapskate_card:   { expireDays:60 },
};

function sanitizeKey(str) { return str.replace(/[.#$/[\]]/g, "_"); }

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

async function fbPost(path, value) {
  await fetch(`${FIREBASE_BASE}/${path}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function checkAndAwardCard(name, number, today, cardConfig) {
  const entry = await fbGet(`dailyCards/${today}/${number}`);
  if (!entry || entry.pickedBy != null) return null;
  // Non-transactional claim — backup script is single-instance, low collision risk
  await fbSet(`dailyCards/${today}/${number}/pickedBy`, name);
  const type = entry.type;
  const expDays = cardConfig?.[type]?.expireDays ?? CARD_DEFAULTS[type]?.expireDays ?? 30;
  const exp = new Date(Date.now() + expDays * 86400000);
  const expiresAt = `${exp.getUTCFullYear()}-${String(exp.getUTCMonth()+1).padStart(2,"0")}-${String(exp.getUTCDate()).padStart(2,"0")}`;
  await fbPost(`userCards/${sanitizeKey(name)}`, { type, expiresAt, obtainedAt: today });
  const poolCount = await fbGet(`cardPool/${type}`);
  await fbSet(`cardPool/${type}`, Math.max(0, (poolCount || 0) - 1));
  return type;
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

function computeStreak(weekly, winnerName, today, todayPtsCount = 99) {
  if (!winnerName) return 0;
  if (todayPtsCount < 4) return 0; // 人數不足，今日不計入連勝
  const pastDates = Object.keys(weekly || {}).filter(d => d < today).sort().reverse();
  let streak = 1;
  for (const date of pastDates) {
    const rec = weekly[date];
    if (!rec) break;
    if (rec.skipStreak) continue; // 人數不足的日子跳過，不累計也不中斷
    if (rec.winner === winnerName && rec.soloWin) continue; // 同一人獨贏，跳過但不中斷連勝
    if (rec.winner === winnerName && !rec.soloWin) { streak++; } else { break; }
  }
  return streak;
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

  // 3. 讀取參加者 & 不參加名單
  const ptsObj = await fbGet("participants");
  const pts = Object.values(ptsObj || {}).sort((a, b) => a.joinedAt - b.joinedAt);
  if (pts.length < 2) {
    console.log(`Only ${pts.length} participant(s), sending no-participants notification`);
    const alreadySent = await fbGet(`weekly/${today}`);
    if (alreadySent) { console.log("No-participants notification already sent, skip"); return; }
    await fbSet(`weekly/${today}`, { noParticipants: true });
    const absentObj0 = await fbGet("absent");
    const absentNames0 = Object.values(absentObj0 || {}).map(v => typeof v === "object" ? v.name : v);
    await fetch(WEBHOOK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noParticipants: 1, totalPeople: pts.length, absent: absentNames0.join(", ") }),
    });
    return;
  }

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

  // 5. 計算結果（含卡牌效果）
  const effective = pts.map(p => {
    if (p.cardUsed === "extra_number" && p.number2) {
      if (p.number === drawnNumber || p.number2 === drawnNumber) return { ...p, number: drawnNumber };
      const d1 = Math.abs(p.number - drawnNumber), d2 = Math.abs(p.number2 - drawnNumber);
      return { ...p, number: d1 <= d2 ? p.number : p.number2 };
    }
    return p;
  });
  const baseResult = determineResult(effective, drawnNumber);
  if (!baseResult) { console.log("No result, skip"); return; }

  // 獨贏最大，soloWin 時跟著我吃卡無效
  let result = baseResult;
  if (!baseResult.soloWin) {
    const fwUsers = effective.filter(p => p.cardUsed === "follow_restaurant");
    if (fwUsers.length > 0) {
      fwUsers.sort((a, b) => Math.abs(a.number - drawnNumber) - Math.abs(b.number - drawnNumber));
      const fw = fwUsers[0];
      result = { ...baseResult, winner: { ...baseResult.winner, rest: fw.rest }, followRestUser: fw.name };
    }
  }

  // 6. 再次確認 weekly 沒被瀏覽器搶先寫入
  const doubleCheck = await fbGet(`weekly/${today}`);
  if (doubleCheck) { console.log("Browser just wrote the result, skip"); return; }

  // 7. 計算連勝並寫入 weekly
  const weeklyAll = await fbGet("weekly");
  const skipStreak = pts.length < 4;
  const streak = (result.soloWin || skipStreak) ? 0 : computeStreak(weeklyAll, result.winner.name, today, pts.length);
  // 人數不足或獨贏時，往前算保留中的連勝數（供通知顯示用）
  let preservedStreak = 0;
  if (skipStreak || result.soloWin) {
    const pastDates = Object.keys(weeklyAll || {}).filter(d => d < today).sort().reverse();
    for (const date of pastDates) {
      const rec = weeklyAll[date];
      if (!rec) break;
      if (rec.skipStreak || (rec.winner === result.winner.name && rec.soloWin)) continue;
      if (rec.winner === result.winner.name && !rec.soloWin) { preservedStreak++; } else { break; }
    }
  }
  const soloTreatPerPerson = result.soloWin ? Math.max(50, preservedStreak >= 3 ? preservedStreak * 10 : 0) : 50;
  const rec = {
    winner: result.winner.name, rest: result.winner.rest,
    soloWin: result.soloWin, drawnNumber, streak,
    ...(skipStreak && { skipStreak: true }),
    ...(result.followRestUser && { followRestUser: result.followRestUser }),
  };
  await fbSet(`weekly/${today}`, rec);
  console.log(`Written weekly/${today}:`, rec);

  // 8. 發卡牌（每位參加者的號碼都檢查）
  const cardConfig = await fbGet("cardConfig") || {};
  const awardedCards = [];
  for (const p of pts) {
    const numbers = [p.number];
    if (p.cardUsed === "extra_number" && p.number2) numbers.push(p.number2);
    for (const n of numbers) {
      const cardType = await checkAndAwardCard(p.name, n, today, cardConfig);
      if (cardType) { awardedCards.push({ name: p.name, type: cardType }); break; }
    }
  }
  if (awardedCards.length > 0) console.log("Cards awarded:", awardedCards);

  // 9. 讀取不參加名單
  const absentObj = await fbGet("absent");
  const absentNames = Object.values(absentObj || {}).map(v => typeof v === "object" ? v.name : v);

  // 10. 送通知
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
      streak,
      treatAmount:     streak >= 3 ? streak * 10 : 0,
      skipStreak:         skipStreak ? 1 : 0,
      preservedStreak,
      soloTreatPerPerson: result.soloWin ? soloTreatPerPerson : 50,
      followRestUser:  result.followRestUser || "",
      cardsUsed:       pts.filter(p => p.cardUsed).map(p => `${p.name} ${CARD_TYPES[p.cardUsed]?.name}${p.cardUsed==="thirsty_card"&&p.drinkOrder?`(${p.drinkOrder})`:"" }`).join(", "),
      thirstyUsers:    pts.filter(p=>p.cardUsed==="thirsty_card").map(p=>`${p.name}${p.drinkOrder?` 想喝${p.drinkOrder}`:""}`).join(", "),
      cardsAwarded:    awardedCards.map(w => `${w.name} ${CARD_TYPES[w.type]?.name}`).join(", "),
    }),
  });
  console.log(`Webhook sent: ${res.status}`);
}

main().catch(err => { console.error(err); process.exit(1); });
