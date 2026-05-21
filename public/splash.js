// src/client/splash.ts
var FINAL_STATES = [
  "Final",
  "Game Over",
  "Final: Tied",
  "Completed Early",
  "Completed Early: Rain",
  "Completed Early: Mercy",
  "Cancelled",
  "Cancelled: Rain"
];
var PRE_GAME_STATES = ["Pre-Game", "Scheduled", "Warmup"];
var isFinalState = (s) => FINAL_STATES.includes(s);
var isPreGameState = (s) => PRE_GAME_STATES.includes(s);
var isLiveState = (s) => !isFinalState(s) && !isPreGameState(s) && !["Postponed", "Suspended", "Suspended: Rain", "Cancelled", "Cancelled: Rain", "Delayed"].includes(s);
var MLB_TEAM_IDS = /* @__PURE__ */ new Set([
  108,
  109,
  110,
  111,
  112,
  113,
  114,
  115,
  116,
  117,
  118,
  119,
  120,
  121,
  133,
  134,
  135,
  136,
  137,
  138,
  139,
  140,
  141,
  142,
  143,
  144,
  145,
  146,
  147,
  158
]);
var gamePk = null;
var pollInterval = null;
var $ = (id) => document.getElementById(id);
function getLogoPath(teamId) {
  return MLB_TEAM_IDS.has(teamId) ? `/teams/dark/${teamId}.svg` : `/teams/${teamId}.svg`;
}
function loadLogo(imgEl, teamId) {
  imgEl.src = getLogoPath(teamId);
}
async function loadHeadshot(imgEl, playerId) {
  if (!imgEl || !playerId) return;
  try {
    const r = await fetch(`/api/headshot/${playerId}`);
    if (!r.ok) return;
    const data = await r.json();
    if (data?.src) imgEl.src = data.src;
  } catch (e) {
    console.error("loadHeadshot error:", e);
  }
}
function formatGameTime(gameDate) {
  const d = new Date(gameDate);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}
function getTeamShortName(team) {
  if (!team) return "";
  if (team.teamName) return team.teamName;
  if (team.clubName) return team.clubName;
  const name = team.name || "";
  if (name.includes("Red Sox")) return "Red Sox";
  if (name.includes("White Sox")) return "White Sox";
  if (name.includes("Blue Jays")) return "Blue Jays";
  const parts = name.split(" ");
  return parts[parts.length - 1] || team.abbreviation || "";
}
function getPitcherSeasonStats(teamBox, pitcherId) {
  if (!teamBox || !pitcherId) return "\u2014";
  const player = teamBox.players?.[`ID${pitcherId}`];
  const stats = player?.seasonStats?.pitching;
  if (!stats) return "\u2014";
  const w = stats.wins ?? 0;
  const l = stats.losses ?? 0;
  const era = stats.era ?? "\u2014";
  const k = stats.strikeOuts ?? 0;
  return `${w}-${l}  \xB7  ${era} ERA  \xB7  ${k} K`;
}
function hideAllStatePanes() {
  ["pregame-content", "live-content", "final-content"].forEach((id) => {
    const el = $(id);
    if (el) el.style.display = "none";
  });
}
function renderPregameContent(data, awayTeam, homeTeam) {
  const teamsBox = data.liveData?.boxscore?.teams || {};
  const probables = data.gameData?.probablePitchers || {};
  const awayPid = probables.away?.id;
  const homePid = probables.home?.id;
  const awayLogo = $("pregame-away-team-logo");
  const homeLogo = $("pregame-home-team-logo");
  if (awayLogo) {
    awayLogo.alt = awayTeam.name;
    loadLogo(awayLogo, awayTeam.id);
  }
  if (homeLogo) {
    homeLogo.alt = homeTeam.name;
    loadLogo(homeLogo, homeTeam.id);
  }
  loadHeadshot($("pregame-away-pitcher-headshot"), awayPid);
  loadHeadshot($("pregame-home-pitcher-headshot"), homePid);
  const awayLabel = $("pregame-away-pitcher-label");
  const homeLabel = $("pregame-home-pitcher-label");
  if (awayLabel) awayLabel.textContent = `${getTeamShortName(awayTeam).toUpperCase()} STARTER`;
  if (homeLabel) homeLabel.textContent = `${getTeamShortName(homeTeam).toUpperCase()} STARTER`;
  $("pregame-away-pitcher-name").textContent = probables.away?.fullName || "TBD";
  $("pregame-home-pitcher-name").textContent = probables.home?.fullName || "TBD";
  $("pregame-away-pitcher-stats").textContent = getPitcherSeasonStats(teamsBox.away, awayPid);
  $("pregame-home-pitcher-stats").textContent = getPitcherSeasonStats(teamsBox.home, homePid);
  const dt = new Date(data.gameData.datetime?.dateTime || Date.now());
  const dateStr = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  const timeStr = formatGameTime(data.gameData.datetime?.dateTime || dt.toISOString());
  $("pregame-first-pitch").textContent = `${dateStr}  \xB7  ${timeStr}`;
}
async function selectTodaysGame() {
  const today = /* @__PURE__ */ new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  try {
    const res = await fetch(`/api/schedule?date=${dateStr}`);
    const data = await res.json();
    const games = data?.dates?.[0]?.games || [];
    if (!games.length) return null;
    const live = games.find((g) => isLiveState(g.status?.detailedState || ""));
    if (live) return live.gamePk;
    const upcoming = games.find((g) => isPreGameState(g.status?.detailedState || ""));
    if (upcoming) return upcoming.gamePk;
    return games[0].gamePk;
  } catch (e) {
    console.error("selectTodaysGame error:", e);
    return null;
  }
}
async function fetchAndRender(pk) {
  try {
    const res = await fetch(`/api/game/${pk}`);
    const data = await res.json();
    if (!data?.gameData || !data?.liveData) {
      console.error("Game data unavailable");
      return;
    }
    render(data);
  } catch (e) {
    console.error("fetchAndRender error:", e);
  }
}
function render(data) {
  const game = data.gameData;
  const linescore = data.liveData.linescore;
  const statusText = game.status.detailedState;
  const awayTeam = game.teams.away;
  const homeTeam = game.teams.home;
  document.body.classList.toggle("is-pregame", isPreGameState(statusText));
  document.body.classList.toggle("is-live", isLiveState(statusText));
  document.body.classList.toggle("is-final", isFinalState(statusText));
  const loading = $("loading-state");
  const content = $("scorebug-content");
  loading.style.display = "none";
  content.style.display = "block";
  const venueName = game.venue?.name || "";
  const dt = new Date(game.datetime?.dateTime || Date.now());
  const dateStr = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  const timeStr = formatGameTime(game.datetime?.dateTime || dt.toISOString());
  $("venue-info").textContent = `${venueName.toUpperCase()} \xB7 ${dateStr} \xB7 ${timeStr}`;
  const broadcasts = game.broadcasts || [];
  const tvBroadcast = broadcasts.find((b) => b.type === "TV" && b.isNational);
  $("network-info").textContent = tvBroadcast?.name || "";
  $("away-logo").alt = awayTeam.name;
  $("home-logo").alt = homeTeam.name;
  loadLogo($("away-logo"), awayTeam.id);
  loadLogo($("home-logo"), homeTeam.id);
  $("away-name").textContent = getTeamShortName(awayTeam);
  $("home-name").textContent = getTeamShortName(homeTeam);
  const awayRec = awayTeam.record;
  const homeRec = homeTeam.record;
  $("away-record").textContent = awayRec ? `${awayRec.wins}-${awayRec.losses}` : "";
  $("home-record").textContent = homeRec ? `${homeRec.wins}-${homeRec.losses}` : "";
  $("away-score").textContent = String(linescore?.teams?.away?.runs ?? 0);
  $("home-score").textContent = String(linescore?.teams?.home?.runs ?? 0);
  const badge = $("status-badge");
  const inning = $("inning-info");
  const countBlock = $("status-count");
  hideAllStatePanes();
  if (isFinalState(statusText)) {
    badge.textContent = "FINAL";
    badge.style.background = "#bf0d3d";
    const n = linescore?.currentInning || 9;
    inning.textContent = n !== 9 ? `F/${n}` : "";
    inning.style.color = "#bf0d3d";
    countBlock.style.display = "none";
    $("dynamic-tab-label").textContent = "WRAP";
    const finEl = $("final-content");
    if (finEl) finEl.style.display = "block";
  } else if (isPreGameState(statusText)) {
    badge.textContent = "";
    inning.textContent = timeStr;
    inning.style.color = "rgba(255,255,255,0.7)";
    countBlock.style.display = "none";
    $("dynamic-tab-label").textContent = "GAME INFO";
    const preEl = $("pregame-content");
    if (preEl) preEl.style.display = "block";
    renderPregameContent(data, awayTeam, homeTeam);
  } else if (statusText === "Postponed") {
    badge.textContent = "PPD";
    badge.style.background = "rgba(255,255,255,0.15)";
    inning.textContent = "";
    countBlock.style.display = "none";
    $("dynamic-tab-label").textContent = "PPD";
  } else if (isLiveState(statusText)) {
    badge.textContent = "LIVE";
    badge.style.background = "#bf0d3d";
    const half = linescore?.inningHalf === "Top" ? "\u25B2" : "\u25BC";
    inning.textContent = `${half} ${linescore?.currentInning || ""}`;
    inning.style.color = "#bf0d3d";
    const cp = data.liveData?.plays?.currentPlay;
    const count = cp?.count;
    if (count) {
      $("balls").textContent = String(count.balls ?? 0);
      $("strikes").textContent = String(count.strikes ?? 0);
      $("outs").textContent = String(count.outs ?? 0);
      countBlock.style.display = "flex";
    } else {
      countBlock.style.display = "none";
    }
    $("dynamic-tab-label").textContent = "LIVE";
    const liveEl = $("live-content");
    if (liveEl) liveEl.style.display = "block";
  } else {
    badge.textContent = statusText.toUpperCase();
    badge.style.background = "rgba(255,255,255,0.15)";
    inning.textContent = "";
    countBlock.style.display = "none";
    $("dynamic-tab-label").textContent = statusText.toUpperCase();
  }
  renderLinescore(linescore, awayTeam, homeTeam, isFinalState(statusText));
}
function renderLinescore(linescore, awayTeam, homeTeam, isFinal) {
  if (!linescore) return;
  const innings = linescore.innings || [];
  const currentInning = linescore.currentInning;
  const maxInnings = Math.max(9, innings.length);
  const awayRuns = linescore.teams?.away?.runs ?? 0;
  const homeRuns = linescore.teams?.home?.runs ?? 0;
  const awayIsLoser = isFinal && homeRuns > awayRuns;
  const homeIsLoser = isFinal && awayRuns > homeRuns;
  let headerCells = '<th class="ls-team-col"></th>';
  for (let i = 1; i <= maxInnings; i++) {
    headerCells += `<th class="ls-inning-h${i === currentInning ? " ls-current" : ""}">${i}</th>`;
  }
  headerCells += '<th class="ls-total ls-r-header">R</th><th class="ls-total ls-h-header">H</th><th class="ls-total ls-e-header">E</th>';
  const buildRow = (teamKey, team) => {
    const abbr = team.abbreviation || team.teamName?.slice(0, 3).toUpperCase() || "\u2014";
    let cells = `<td class="ls-team-col">
      <img class="ls-team-logo" src="${getLogoPath(team.id)}" alt="${abbr}">
      <span class="ls-team-abbr">${abbr}</span>
    </td>`;
    for (let i = 1; i <= maxInnings; i++) {
      const inn = innings.find((x) => x.num === i);
      const runs = inn?.[teamKey]?.runs;
      const isCurrent = i === currentInning;
      let cls = "ls-inning";
      if (runs == null) cls += " ls-empty";
      else if (runs === 0) cls += " ls-zero";
      else cls += " ls-nonzero";
      if (isCurrent) cls += " ls-current";
      cells += `<td class="${cls}">${runs == null ? "\u2013" : runs}</td>`;
    }
    const t = linescore.teams[teamKey];
    const r = t?.runs ?? 0;
    const h = t?.hits ?? 0;
    const e = t?.errors ?? 0;
    cells += `<td class="ls-total ls-r-value ${r === 0 ? "ls-zero" : "ls-nonzero"}">${r}</td>`;
    cells += `<td class="ls-total ls-h-value ${h === 0 ? "ls-zero" : "ls-nonzero"}">${h}</td>`;
    cells += `<td class="ls-total ls-e-value">${e}</td>`;
    return cells;
  };
  const awayRowClass = awayIsLoser ? "ls-row-loser" : "";
  const homeRowClass = homeIsLoser ? "ls-row-loser" : "";
  $("linescore-container").innerHTML = `
    <table class="linescore-compact">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>
        <tr class="ls-row-away ${awayRowClass}">${buildRow("away", awayTeam)}</tr>
        <tr class="ls-row-home ${homeRowClass}">${buildRow("home", homeTeam)}</tr>
      </tbody>
    </table>`;
}
function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.dataset.tab;
      if (!targetTab) return;
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("tab-active"));
      btn.classList.add("tab-active");
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("tab-content-active"));
      $(`tab-${targetTab}`)?.classList.add("tab-content-active");
    });
  });
}
function startPolling(pk) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => fetchAndRender(pk), 1e4);
}
(async () => {
  setupTabs();
  gamePk = await selectTodaysGame();
  if (!gamePk) {
    $("loading-state").textContent = "No games today.";
    return;
  }
  await fetchAndRender(gamePk);
  startPolling(gamePk);
})();
//# sourceMappingURL=splash.js.map
