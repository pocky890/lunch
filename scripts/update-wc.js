const DB = "https://launch-fdd3a-default-rtdb.firebaseio.com/lunch";
const FD_KEY = "5d480cad43b349ac9a56f79fc3ee8552";
const ODDS_KEY = "f017ab09768e8e7b9a1cc60340809ce3";

async function fbGet(path) {
  const r = await fetch(`${DB}/${path}.json`);
  if (!r.ok) throw new Error(`GET ${path} failed: ${r.status}`);
  return r.json();
}

async function fbSet(path, val) {
  const r = await fetch(`${DB}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(val),
  });
  if (!r.ok) throw new Error(`SET ${path} failed: ${r.status}`);
}

async function fbPost(path, val) {
  const r = await fetch(`${DB}/${path}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(val),
  });
  if (!r.ok) throw new Error(`POST ${path} failed: ${r.status}`);
}

async function fbPatch(path, val) {
  const r = await fetch(`${DB}/${path}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(val),
  });
  if (!r.ok) throw new Error(`PATCH ${path} failed: ${r.status}`);
}

async function updateMatches() {
  const resp = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": FD_KEY },
  });
  if (!resp.ok) { console.log(`❌ Matches: HTTP ${resp.status}`); return; }
  const data = await resp.json();
  const ms = {};
  for (const m of (data.matches || [])) {
    ms[m.id] = {
      id: m.id,
      homeTeam: m.homeTeam.shortName || m.homeTeam.name,
      awayTeam: m.awayTeam.shortName || m.awayTeam.name,
      utcDate: m.utcDate,
      status: m.status,
      stage: m.stage,
      group: m.group || null,
      homeScore: m.score?.fullTime?.home ?? null,
      awayScore: m.score?.fullTime?.away ?? null,
    };
  }
  await fbSet("wc2026/matches", ms);
  console.log(`✅ Matches: ${Object.keys(ms).length} 場已更新`);
}

async function updateOdds() {
  const last = await fbGet("wc2026/lastOddsFetch");
  if (last && Date.now() - last < 24 * 60 * 60 * 1000) {
    console.log("⏭  Odds: 未到 24 小時，略過");
    return;
  }
  const resp = await fetch(
    `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/?apiKey=${ODDS_KEY}&regions=eu&markets=h2h`
  );
  if (!resp.ok) { console.log(`❌ Odds: HTTP ${resp.status}`); return; }
  const data = await resp.json();
  if (!Array.isArray(data)) return;

  const matches = await fbGet("wc2026/matches");
  if (!matches) return;

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lookup = {};
  for (const [mid, m] of Object.entries(matches)) {
    lookup[`${norm(m.homeTeam)}|${norm(m.awayTeam)}`] = mid;
  }

  const updates = {};
  for (const entry of data) {
    const mid = lookup[`${norm(entry.home_team)}|${norm(entry.away_team)}`];
    if (!mid) continue;
    const market = entry.bookmakers?.[0]?.markets?.find(mk => mk.key === "h2h");
    if (!market) continue;
    const homeO = market.outcomes.find(o => norm(o.name) === norm(entry.home_team));
    const awayO = market.outcomes.find(o => norm(o.name) === norm(entry.away_team));
    const drawO = market.outcomes.find(o => o.name === "Draw");
    if (!homeO || !awayO) continue;
    updates[mid] = { home: homeO.price, draw: drawO?.price || 0, away: awayO.price };
  }

  if (Object.keys(updates).length > 0) await fbPatch("wc2026/odds", updates);
  await fbSet("wc2026/lastOddsFetch", Date.now());
  console.log(`✅ Odds: ${Object.keys(updates).length} 場已更新`);
}

const WC_TEAM_ZH = {
  "Algeria":"阿爾及利亞","Argentina":"阿根廷","Australia":"澳洲","Austria":"奧地利",
  "Belgium":"比利時","Bosnia-H.":"波赫","Bosnia-Herzegovina":"波赫","Brazil":"巴西",
  "Canada":"加拿大","Cape Verde":"維德角","Cape Verde Islands":"維德角",
  "Colombia":"哥倫比亞","Congo DR":"剛果（金）","Croatia":"克羅埃西亞",
  "Czechia":"捷克","Ecuador":"厄瓜多","Egypt":"埃及","England":"英格蘭",
  "France":"法國","Germany":"德國","Ghana":"迦納","Haiti":"海地",
  "Iran":"伊朗","Iraq":"伊拉克","Ivory Coast":"象牙海岸","Japan":"日本",
  "Jordan":"約旦","Korea Republic":"韓國","Mexico":"墨西哥","Morocco":"摩洛哥",
  "Netherlands":"荷蘭","New Zealand":"紐西蘭","Nigeria":"奈及利亞","Norway":"挪威",
  "Panama":"巴拿馬","Paraguay":"巴拉圭","Portugal":"葡萄牙","Qatar":"卡達",
  "Saudi Arabia":"沙烏地阿拉伯","Scotland":"蘇格蘭","Senegal":"塞內加爾",
  "South Africa":"南非","South Korea":"韓國","Spain":"西班牙","Sweden":"瑞典",
  "Switzerland":"瑞士","Tunisia":"突尼西亞","Turkey":"土耳其",
  "United States":"美國","USA":"美國","Uruguay":"烏拉圭","Uzbekistan":"烏茲別克",
};
const zhTeam = n => WC_TEAM_ZH[n] || n;

async function settleMatches() {
  const [allBets, matches, odds] = await Promise.all([
    fbGet("wc2026/bets"),
    fbGet("wc2026/matches"),
    fbGet("wc2026/odds"),
  ]);
  if (!allBets || !matches) { console.log("⏭  Settlement: 無投注資料"); return; }

  const now = Date.now();
  let settled = 0;

  for (const [mid, bets] of Object.entries(allBets)) {
    const m = matches[mid];
    if (!m || now < new Date(m.utcDate).getTime()) continue;
    if (!["FINISHED","AWARDED"].includes(m.status)) continue;
    if (m.homeScore === null || m.homeScore === undefined ||
        m.awayScore === null || m.awayScore === undefined) continue;

    const result = m.homeScore > m.awayScore ? "home" : m.homeScore < m.awayScore ? "away" : "draw";
    const o = (odds && odds[mid]) || {};
    const mName = `${zhTeam(m.homeTeam)} vs ${zhTeam(m.awayTeam)}`;

    for (const [uKey, bet] of Object.entries(bets)) {
      if (bet.settled) continue;
      const payout = bet.pick === result ? Math.round(bet.amount * (o[result] || 1)) : 0;
      if (payout > 0) {
        const cur = (await fbGet(`userPoints/${uKey}`)) || 0;
        await fbSet(`userPoints/${uKey}`, cur + payout);
        await fbPost(`pointsLog/${uKey}`, { type: "wc_win", delta: payout, note: mName, ts: now });
      } else {
        await fbPost(`pointsLog/${uKey}`, { type: "wc_lose", delta: 0, note: mName, ts: now });
      }
      await fbPatch(`wc2026/bets/${mid}/${uKey}`, { settled: true, payout });
      settled++;
    }
  }

  console.log(settled > 0 ? `✅ Settlement: ${settled} 筆投注已結算` : "⏭  Settlement: 無待結算投注");
}

(async () => {
  try { await updateMatches(); } catch (e) { console.error("Matches error:", e.message); }
  try { await updateOdds(); } catch (e) { console.error("Odds error:", e.message); }
  try { await settleMatches(); } catch (e) { console.error("Settlement error:", e.message); }
})();
