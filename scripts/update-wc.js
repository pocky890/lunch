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

(async () => {
  try { await updateMatches(); } catch (e) { console.error("Matches error:", e.message); }
  try { await updateOdds(); } catch (e) { console.error("Odds error:", e.message); }
})();
