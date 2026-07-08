/* StadiumIQ ops console.
   Plain zero-build JS. All dynamic text is inserted via textContent /
   createElement — never innerHTML — so API/LLM output cannot inject markup
   (XSS-safe by construction). SVG marks are built with createElementNS +
   attributes; static styling lives in the stylesheet, dynamic values go
   through CSSOM property assignment (strict CSP: no inline style attrs). */
"use strict";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const language = () => $("language").value;

const PHASE_LABELS = {
  ingress: "Gates open — ingress",
  pre_match: "Pre-match build-up",
  first_half: "First half",
  halftime: "Halftime",
  second_half: "Second half",
  egress: "Full time — egress",
};

/* Zone kinds → bowl-map slots (venue-specific presentation; values are live).
   Zones not named here are appended in an extra row so a new venue map can
   never silently drop telemetry from the page. */
const BOWL_LAYOUT = [
  ["level2_west", "north_concourse", "level2_east"],
  ["west_concourse", null, "east_concourse"], // null = the pitch cell
  ["south_concourse", "fan_plaza"],
];

const HISTORY_LIMIT = 30;
const occupancyHistory = []; // fractions of capacity, oldest → newest

/* Session-local operator state (which alerts this console acknowledged). */
const ackedAlerts = new Set();
const alertKey = (a) => `${a.zone_id}|${a.message}`;

/* Populated at boot from /api/health and /api/stadium/map. */
let providerNames = [];
let zoneNameById = {};
let nodeNameById = {};
let lastLatencyMs = null;
let prevSnapshot = null;

/* ---------------- API helper ---------------- */

/* Single fetch wrapper: JSON in/out, and server `detail` messages become
   Error messages so every catch block can show a human-readable reason. */
async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail || `Request failed (${response.status})`);
  }
  return response.json();
}

/* ---------------- Router (hash-based pages) ---------------- */

/* Client-side routing with zero dependencies: each sidebar item is a real
   page at #/<name>, so browser back/forward and deep links work. On
   navigation we set document.title and move focus to the header's page
   heading (tabindex="-1") so screen readers announce the change. */
const ROUTES = {
  "#/overview": { view: "view-overview", title: "Overview", sub: "Full-venue situational awareness" },
  "#/crowd": { view: "view-crowd", title: "Crowd intelligence", sub: "Real-time density by zone" },
  "#/gates": { view: "view-gates", title: "Gate management", sub: "Throughput and queue control" },
  "#/briefings": { view: "view-briefings", title: "AI briefings", sub: "GenAI situation reports from live telemetry" },
  "#/alerts": { view: "view-alerts", title: "Alerts", sub: "Active advisories with recommended actions" },
  "#/assistant": { view: "view-assistant", title: "Assistant", sub: "Multilingual fan copilot, grounded in venue state" },
  "#/navigator": { view: "view-navigator", title: "Step-free navigator", sub: "Accessible routing and facilities" },
};

function showPage(hash, { focus = true } = {}) {
  const route = ROUTES[hash] || ROUTES["#/overview"];
  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== route.view;
  });
  document.querySelectorAll(".side-link").forEach((link) => {
    if (ROUTES[link.getAttribute("href")] === route) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
  $("page-title").textContent = route.title;
  $("page-sub").textContent = route.sub;
  document.title = `${route.title} · StadiumIQ`;
  window.scrollTo(0, 0);
  if (focus) $("page-title").focus();
}

window.addEventListener("hashchange", () => showPage(location.hash));
showPage(location.hash, { focus: false }); // initial load: never steal focus

/* ---------------- Small builders ---------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tag(text, tone) {
  return el("span", `tag tag-${tone}`, text);
}

/* Match clock for the LIVE chip: "-42'" pre-kickoff, "HT", "FT", or "67'". */
function formatClock(minute, phase) {
  if (phase === "halftime") return "HT";
  if (phase === "egress") return "FT";
  return `${minute}'`;
}

/* Severity mapping shared by tags, dots, and row accents (text always
   accompanies the color — never color alone). */
const STATUS_TONE = { low: "good", moderate: "good", high: "warn", critical: "crit" };

/* ---------------- Overview: occupancy sparkline ---------------- */

/* One large area sparkline over the occupancy fraction history. Decorative
   (aria-hidden): the live percentage sits next to it as text, and the zone
   table remains the canonical non-visual view. */
function drawOccSpark(values) {
  const svg = $("occ-spark");
  svg.replaceChildren();
  if (values.length < 2) return;
  const w = 520;
  const h = 90;
  const min = Math.min(...values) - 0.02;
  const max = Math.max(...values) + 0.02;
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - ((v - min) / span) * h,
  ]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

  const defs = document.createElementNS(SVG_NS, "defs");
  const grad = document.createElementNS(SVG_NS, "linearGradient");
  grad.setAttribute("id", "occ-grad");
  grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
  for (const [offset, opacity] of [["0", "0.35"], ["1", "0"]]) {
    const stop = document.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", "#34d17e");
    stop.setAttribute("stop-opacity", opacity);
    grad.append(stop);
  }
  defs.append(grad);

  const area = document.createElementNS(SVG_NS, "path");
  area.setAttribute("d", `${line} L${w} ${h} L0 ${h} Z`);
  area.setAttribute("fill", "url(#occ-grad)");

  const stroke = document.createElementNS(SVG_NS, "path");
  stroke.setAttribute("class", "occ-line");
  stroke.setAttribute("d", line);

  const [lastX, lastY] = pts[pts.length - 1];
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("class", "occ-dot");
  dot.setAttribute("cx", lastX.toFixed(1));
  dot.setAttribute("cy", lastY.toFixed(1));
  dot.setAttribute("r", "4");

  svg.append(defs, area, stroke, dot);
}

/* ---------------- Overview: system status + priority actions ---------------- */

function sysRow(name, state, tone) {
  const li = el("li", "sys-row");
  li.append(
    el("span", `glow-dot glow-${tone}`),
    el("span", "sys-name", name),
    el("span", `sys-state${tone === "good" ? "" : ` state-${tone}`}`, state)
  );
  return li;
}

function renderSystems(snapshot) {
  const live = providerNames.some((p) => p !== "mock");
  const critical = snapshot.alerts.some((a) => a.severity === "critical");
  const latency = lastLatencyMs === null ? "—" : `${lastLatencyMs} ms`;
  $("sys-list").replaceChildren(
    sysRow("Crowd telemetry", "Operational", "good"),
    sysRow(
      "GenAI chain",
      live ? `Live · ${providerNames.join(" → ")}` : "Offline demo mode",
      live ? "good" : "warn"
    ),
    sysRow("API latency", latency, lastLatencyMs !== null && lastLatencyMs > 500 ? "warn" : "good"),
    sysRow(
      "Alert engine",
      snapshot.alerts.length
        ? `${snapshot.alerts.length} active${critical ? " · critical" : ""}`
        : "All clear",
      critical ? "crit" : snapshot.alerts.length ? "warn" : "good"
    )
  );
}

/* Alerts ranked critical-first become the "Priority actions" queue — each
   alert already carries a concrete recommendation from the telemetry engine. */
function renderActions(snapshot) {
  const ranked = [...snapshot.alerts].sort(
    (a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1)
  );
  const list = $("actions-list");
  if (!ranked.length) {
    const li = el("li", "action-row action-info");
    li.append(
      el("span", "action-rank", "✓"),
      (() => {
        const body = el("div", "action-body");
        body.append(
          el("p", "action-title", "No actions required"),
          el("p", "action-detail", "All zones and gates are within normal operating bounds.")
        );
        return body;
      })()
    );
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...ranked.slice(0, 4).map((alert, index) => {
      const crit = alert.severity === "critical";
      const li = el("li", `action-row${crit ? " action-crit" : ""}`);
      const body = el("div", "action-body");
      body.append(
        el("p", "action-title", alert.recommendation),
        el("p", "action-detail", alert.message)
      );
      li.append(
        el("span", "action-rank", String(index + 1)),
        body,
        el("span", "action-where", zoneNameById[alert.zone_id] || nodeNameById[alert.zone_id] || alert.zone_id)
      );
      return li;
    })
  );
  $("actions-age").textContent = `Ranked by severity · updated ${new Date().toLocaleTimeString()}`;
}

/* ---------------- Crowd: bowl map + zone table ---------------- */

function bowlCell(zone) {
  const statusClass =
    zone.status === "critical" ? " density-critical" : zone.status === "high" ? " density-busy" : "";
  const cell = el("div", `bowl-cell${statusClass}`);
  cell.append(
    el("div", "bowl-zone", zone.name),
    el("div", "bowl-pct", `${Math.round(zone.density * 100)}%`),
    el("div", "bowl-status", zone.status)
  );
  return cell;
}

function renderBowl(zones) {
  const byId = Object.fromEntries(zones.map((z) => [z.zone_id, z]));
  const placed = new Set();
  const rowClass = ["bowl-row", "bowl-row bowl-row-mid", "bowl-row bowl-row-bottom"];
  const rows = BOWL_LAYOUT.map((slots, index) => {
    const row = el("div", rowClass[index] || "bowl-row");
    for (const slot of slots) {
      if (slot === null) {
        const pitch = el("div", "bowl-pitch");
        pitch.append(el("span", null, "Pitch"));
        row.append(pitch);
      } else if (byId[slot]) {
        row.append(bowlCell(byId[slot]));
        placed.add(slot);
      }
    }
    return row;
  });
  const leftovers = zones.filter((z) => !placed.has(z.zone_id));
  if (leftovers.length) {
    const row = el("div", "bowl-row");
    leftovers.forEach((z) => row.append(bowlCell(z)));
    rows.push(row);
  }
  $("bowl").replaceChildren(...rows);
}

function tableRow(cells) {
  const tr = document.createElement("tr");
  for (const cell of cells) {
    const td = document.createElement("td");
    if (cell instanceof Node) {
      td.className = "cell-end";
      td.append(cell);
    } else {
      td.textContent = cell.text;
      if (cell.num) td.className = "num";
    }
    tr.append(td);
  }
  return tr;
}

/* ---------------- Gates: cards + table ---------------- */

/* Simulator peak queue is ~260 fans; the load bar normalizes against it. */
const GATE_QUEUE_PEAK = 260;

function gateTone(gate) {
  if (gate.wait_minutes >= 10) return { cls: "gate-congested", label: "Congested", tone: "crit" };
  if (gate.wait_minutes >= 5) return { cls: "gate-busy", label: "Busy", tone: "warn" };
  return { cls: "", label: "Flowing", tone: "good" };
}

function gateCard(gate) {
  const { cls, label, tone } = gateTone(gate);
  const card = el("article", `card gate-card${cls ? ` ${cls}` : ""}`);

  const head = el("div", "gate-head");
  head.append(el("h3", "gate-name", gate.name), tag(label, tone));

  const stats = el("div", "gate-stats");
  const tp = el("div");
  tp.append(el("p", "gate-stat-label", "Throughput"));
  const tpValue = el("p", "gate-stat-value", String(gate.throughput_per_min));
  tpValue.append(el("span", "gate-stat-unit", " /min"));
  tp.append(tpValue);
  const queue = el("div");
  queue.append(
    el("p", "gate-stat-label", "Queue"),
    el("p", "gate-stat-value gate-queue", String(gate.queue_length))
  );
  stats.append(tp, queue);

  const load = el("div", "gate-load");
  const fill = el("div", "gate-load-fill");
  fill.style.width = `${Math.min(100, Math.round((gate.queue_length / GATE_QUEUE_PEAK) * 100))}%`;
  load.append(fill);

  card.append(head, stats, load, el("p", "gate-note", `≈ ${gate.wait_minutes} min wait at current throughput`));
  return card;
}

/* ---------------- Alerts: feed + acknowledge ---------------- */

function alertRow(alert) {
  const acked = ackedAlerts.has(alertKey(alert));
  const crit = alert.severity === "critical";
  const li = el("li", `alert-row${acked ? " alert-acked" : ""}`);

  const main = el("div", "alert-main");
  const titleRow = el("div", "alert-title-row");
  titleRow.append(
    tag(crit ? "Critical" : "Warning", crit ? "crit" : "warn"),
    el("span", "alert-title", alert.message)
  );
  main.append(
    titleRow,
    el("p", "alert-sub", `${zoneNameById[alert.zone_id] || nodeNameById[alert.zone_id] || alert.zone_id} · ${alert.recommendation}`)
  );

  const btn = el("button", "btn-ack", acked ? "Acknowledged" : "Acknowledge");
  btn.disabled = acked;
  if (!acked) {
    btn.addEventListener("click", () => {
      ackedAlerts.add(alertKey(alert));
      renderCrowd(prevSnapshot); // re-render feed + badge from the same snapshot
    });
  }

  li.append(el("span", `glow-dot glow-${crit ? "crit" : "warn"}`), main, btn);
  return li;
}

function renderAlerts(snapshot) {
  const feed = $("alert-feed");
  if (!snapshot.alerts.length) {
    const li = el("li", "alert-empty", "✓ No active alerts — venue nominal.");
    feed.replaceChildren(li);
  } else {
    feed.replaceChildren(...snapshot.alerts.map(alertRow));
  }
  const unacked = snapshot.alerts.filter((a) => !ackedAlerts.has(alertKey(a))).length;
  const badge = $("alert-badge");
  badge.hidden = unacked === 0;
  badge.textContent = String(unacked);
}

/* ---------------- KPI trends ---------------- */

function setTrend(id, text, direction) {
  const node = $(id);
  node.textContent = text;
  node.classList.remove("trend-up", "trend-down");
  if (direction) node.classList.add(direction);
}

/* ---------------- Crowd dashboard (renders every page's live widgets) ---------------- */

function renderCrowd(snapshot) {
  if (!snapshot) return;
  $("live-clock").textContent = formatClock(snapshot.match_minute, snapshot.phase);
  $("phase-label").textContent = PHASE_LABELS[snapshot.phase] || snapshot.phase;

  // KPIs
  const totalOcc = snapshot.zones.reduce((sum, z) => sum + z.occupancy, 0);
  const totalCap = snapshot.zones.reduce((sum, z) => sum + z.capacity, 0);
  $("kpi-occupancy").textContent = totalOcc.toLocaleString();
  $("kpi-occupancy-hint").textContent = `${Math.round((totalOcc / totalCap) * 100)}% of concourse capacity`;

  const busiest = [...snapshot.zones].sort((a, b) => b.density - a.density)[0];
  $("kpi-busiest").textContent = busiest.name;
  $("kpi-busiest-hint").textContent = `${Math.round(busiest.density * 100)}% full`;

  const fastest = [...snapshot.gates].sort((a, b) => a.wait_minutes - b.wait_minutes)[0];
  $("kpi-gate").textContent = fastest.name;
  $("kpi-gate-hint").textContent = `≈ ${fastest.wait_minutes} min wait`;

  const critical = snapshot.alerts.filter((a) => a.severity === "critical").length;
  $("kpi-alerts").textContent = String(snapshot.alerts.length);
  $("kpi-alerts-hint").textContent = critical
    ? `${critical} critical`
    : snapshot.alerts.length
      ? "warnings only"
      : "all clear";

  // Trends vs the previous snapshot (live deltas, not invented ones).
  if (prevSnapshot) {
    const prevOcc = prevSnapshot.zones.reduce((sum, z) => sum + z.occupancy, 0);
    const occDelta = totalOcc - prevOcc;
    setTrend(
      "kpi-occupancy-trend",
      occDelta === 0 ? "steady" : `${occDelta > 0 ? "▲" : "▼"} ${Math.abs(occDelta).toLocaleString()}`,
      occDelta > 0 ? "trend-up" : occDelta < 0 ? "trend-down" : null
    );
    const prevFastest = [...prevSnapshot.gates].sort((a, b) => a.wait_minutes - b.wait_minutes)[0];
    const waitDelta = fastest.wait_minutes - prevFastest.wait_minutes;
    setTrend(
      "kpi-gate-trend",
      waitDelta === 0 ? "steady" : `${waitDelta > 0 ? "▲" : "▼"} ${Math.abs(waitDelta)} min`,
      waitDelta < 0 ? "trend-up" : waitDelta > 0 ? "trend-down" : null
    );
    const alertDelta = snapshot.alerts.length - prevSnapshot.alerts.length;
    setTrend(
      "kpi-alerts-trend",
      alertDelta === 0 ? "steady" : `${alertDelta > 0 ? "▲" : "▼"} ${Math.abs(alertDelta)}`,
      alertDelta > 0 ? "trend-down" : alertDelta < 0 ? "trend-up" : null
    );
  }
  setTrend(
    "kpi-busiest-trend",
    busiest.status,
    busiest.status === "critical" || busiest.status === "high" ? "trend-down" : null
  );

  // Overview widgets
  occupancyHistory.push(totalOcc / totalCap);
  if (occupancyHistory.length > HISTORY_LIMIT) occupancyHistory.shift();
  $("occ-pct").textContent = `${Math.round((totalOcc / totalCap) * 100)}%`;
  drawOccSpark(occupancyHistory);
  renderSystems(snapshot);
  renderActions(snapshot);

  // Crowd page
  renderBowl(snapshot.zones);
  $("crowd-table").querySelector("tbody").replaceChildren(
    ...snapshot.zones.map((z) =>
      tableRow([
        { text: z.name },
        { text: `${z.occupancy.toLocaleString()} / ${z.capacity.toLocaleString()}`, num: true },
        { text: `${Math.round(z.density * 100)}%`, num: true },
        tag(z.status, STATUS_TONE[z.status] || "info"),
      ])
    )
  );
  $("crowd-updated").textContent = `updated ${new Date().toLocaleTimeString()}`;

  // Gates page
  $("gate-grid").replaceChildren(...snapshot.gates.map(gateCard));
  $("gate-table").querySelector("tbody").replaceChildren(
    ...snapshot.gates.map((g) =>
      tableRow([
        { text: g.name },
        { text: `${g.queue_length.toLocaleString()} fans`, num: true },
        { text: `${g.wait_minutes} min`, num: true },
        { text: `${g.throughput_per_min} fans/min`, num: true },
      ])
    )
  );

  // Alerts page + sidebar badge
  renderAlerts(snapshot);

  prevSnapshot = snapshot;
}

/* 10-second poll of the unmetered telemetry endpoint (never the LLM ones). */
async function refreshCrowd() {
  try {
    const started = performance.now();
    const snapshot = await api("/api/crowd/status");
    lastLatencyMs = Math.max(1, Math.round(performance.now() - started));
    renderCrowd(snapshot);
  } catch {
    $("phase-label").textContent = "telemetry offline";
  }
}

/* Seed the occupancy history with the minutes leading up to "now" —
   telemetry is a deterministic function of the match clock, so history
   is queryable. */
async function seedHistory() {
  const started = performance.now();
  const current = await api("/api/crowd/status");
  lastLatencyMs = Math.max(1, Math.round(performance.now() - started));
  const minutes = [];
  for (let m = current.match_minute - 28; m < current.match_minute; m += 2) {
    if (m >= -90) minutes.push(m);
  }
  const snapshots = await Promise.all(
    minutes.map((m) => api(`/api/crowd/status?match_minute=${m}`).catch(() => null))
  );
  for (const snap of snapshots) {
    if (!snap) continue;
    const occ = snap.zones.reduce((s, z) => s + z.occupancy, 0);
    const cap = snap.zones.reduce((s, z) => s + z.capacity, 0);
    occupancyHistory.push(occ / cap);
  }
  renderCrowd(current);
}

/* ---------------- AI briefings ---------------- */

/* Each generated briefing becomes a card at the top of the feed, so a shift
   supervisor can compare situation reports across the match. */
function briefingCard(data) {
  const card = el("section", "card briefing-card");
  const meta = el("div", "briefing-meta");
  meta.append(
    tag("Briefing", "good"),
    el("span", "briefing-time", new Date().toLocaleTimeString()),
    el("span", "briefing-via", `via ${data.provider} · ${data.model}`)
  );
  const body = el("div", "briefing-body", data.briefing);
  body.setAttribute("dir", "auto"); // RTL briefings (Arabic) align correctly
  card.append(
    meta,
    el("h3", "briefing-title", `${PHASE_LABELS[data.phase] || data.phase} · minute ${data.match_minute}`),
    body
  );
  return card;
}

$("briefing-btn").addEventListener("click", async () => {
  const btn = $("briefing-btn");
  const feed = $("briefing-feed");
  btn.disabled = true;
  btn.textContent = "Generating…";
  try {
    const data = await api("/api/ops/briefing", {
      method: "POST",
      body: JSON.stringify({ language: language() }),
    });
    feed.querySelector(".placeholder")?.closest(".briefing-card")?.remove();
    feed.prepend(briefingCard(data));
  } catch (err) {
    const card = el("section", "card briefing-card");
    card.append(el("p", "error-note", `Could not generate briefing: ${err.message}`));
    feed.prepend(card);
  } finally {
    btn.disabled = false;
    btn.textContent = "✦ Generate briefing";
  }
});

/* ---------------- Fan assistant chat ---------------- */

/* Append a chat bubble. Text lands via textContent (never innerHTML), so
   LLM output can't inject markup even if a provider were compromised. */
function addMessage(kind, text, meta) {
  const log = $("chat-log");
  const div = el("div", `msg msg-${kind}`);
  const p = document.createElement("p");
  // dir="auto" lets each bubble pick its direction from its own content,
  // so RTL (Arabic) replies align correctly in an otherwise LTR page.
  p.setAttribute("dir", "auto");
  p.textContent = text;
  div.append(p);
  if (meta) div.append(el("span", "msg-meta", meta));
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

/* Optimistic send: show the user's bubble and a "Thinking…" placeholder,
   then swap the placeholder for the reply (or the error) in place. */
async function sendChat(message) {
  addMessage("user", message);
  const pending = addMessage("bot", "Thinking…");
  pending.classList.add("msg-thinking");
  $("chat-send").disabled = true;
  try {
    const data = await api("/api/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ message, language: language() }),
    });
    pending.classList.remove("msg-thinking");
    pending.querySelector("p").textContent = data.reply;
    pending.append(el("span", "msg-meta", `${data.provider} · ${data.model}`));
  } catch (err) {
    pending.classList.remove("msg-thinking");
    pending.querySelector("p").textContent = `Sorry — ${err.message}`;
  } finally {
    $("chat-send").disabled = false;
  }
}

$("chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("chat-input");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  sendChat(message);
});

document.querySelectorAll(".quick").forEach((btn) =>
  btn.addEventListener("click", () => sendChat(btn.dataset.q))
);

/* ---------------- Step-free navigator ---------------- */

/* Facility icons by node kind (stroke SVGs, aria-hidden decorations). */
const FACILITY_KINDS = {
  elevator: "M9 8l3-3 3 3M9 16l3 3 3-3",
  restroom: "M12 5a2 2 0 1 0 0.01 0M9 21v-6M15 21v-6M9 12h6",
  medical: "M12 8v8M8 12h8",
  accessibility: "M12 3a6 6 0 0 0-6 6c0 4 3 5 3 8h6c0-3 3-4 3-8a6 6 0 0 0-6-6Z",
  transport: "M5 4h14v12H5zM5 12h14M8 20l1-4M16 20l-1-4",
};

function facilityRow(node) {
  const row = el("article", "card facility-row");
  const icon = el("span", "facility-icon");
  icon.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", FACILITY_KINDS[node.kind]);
  svg.append(path);
  icon.append(svg);

  const body = el("div", "facility-body");
  body.append(
    el("p", "facility-name", node.name),
    el("p", "facility-detail", `${zoneNameById[node.zone] || node.zone} · level ${node.level}`)
  );
  row.append(icon, body, tag("Routable", "good"));
  return row;
}

/* Fill both origin/destination selects from the venue map, alphabetized,
   with a sensible default journey (arrival gate → a seating section).
   Also derives the accessible-facilities panel from the same map data. */
async function populateNavigator() {
  const map = await api("/api/stadium/map");
  $("venue-name").textContent = map.venue;
  zoneNameById = Object.fromEntries(map.zones.map((z) => [z.id, z.name]));
  nodeNameById = Object.fromEntries(map.nodes.map((n) => [n.id, n.name]));

  const options = map.nodes
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => {
      const opt = document.createElement("option");
      opt.value = n.id;
      opt.textContent = n.name;
      return opt;
    });
  $("nav-origin").replaceChildren(...options);
  $("nav-destination").replaceChildren(...options.map((o) => o.cloneNode(true)));
  $("nav-origin").value = "gate_e1";
  $("nav-destination").value = "sec_201";

  $("facility-col").replaceChildren(
    ...map.nodes.filter((n) => FACILITY_KINDS[n.kind]).map(facilityRow)
  );
}

$("nav-swap").addEventListener("click", () => {
  const origin = $("nav-origin");
  const destination = $("nav-destination");
  [origin.value, destination.value] = [destination.value, origin.value];
});

function routeStep(step, index) {
  const li = el("li", "route-step");
  const rail = el("div", "route-step-rail");
  rail.append(el("span", "route-step-dot", String(index + 1)), el("span", "route-step-line"));
  const body = el("div", "route-step-body");
  const detail =
    step.meters_from_previous > 0 ? `${step.kind} · ${step.meters_from_previous} m` : step.kind;
  body.append(el("p", "route-step-title", step.name), el("p", "route-step-detail", detail));
  li.append(rail, body);
  return li;
}

$("nav-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const btn = $("nav-btn");
  const out = $("nav-result");
  btn.disabled = true;
  btn.textContent = "Routing…";
  try {
    const data = await api("/api/navigate", {
      method: "POST",
      body: JSON.stringify({
        origin: $("nav-origin").value,
        destination: $("nav-destination").value,
        accessible: $("nav-accessible").checked,
        narrate: true,
        language: language(),
      }),
    });

    out.replaceChildren();

    const summary = el("div", "route-summary");
    const dist = el("span");
    dist.append("Distance: ", el("strong", null, `${data.total_meters} m`));
    const time = el("span");
    time.append("Walk: ", el("strong", null, `≈ ${data.est_minutes} min`));
    summary.append(dist, time);
    if (data.accessible) summary.append(tag("♿ step-free verified", "good"));
    out.append(summary);

    const steps = el("ol", "route-steps");
    data.steps.forEach((step, index) => steps.append(routeStep(step, index)));
    out.append(steps);

    if (data.directions) {
      const dir = el("div", "route-directions");
      // Narration follows the fan's language; render bidi-safe like chat.
      dir.setAttribute("dir", "auto");
      dir.textContent = data.directions;
      out.append(dir, el("span", "provider-tag", `narrated by ${data.provider}`));
    }
  } catch (err) {
    out.replaceChildren(el("p", "error-note", err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = "Find route";
  }
});

/* ---------------- Boot ---------------- */

/* Sidebar provider list: the real chain from /api/health, in fallback order,
   with the offline mock always shown as the terminator. */
function renderProviders() {
  const roles = { nvidia: "primary", gemini: "backup", mock: "fallback" };
  const rows = ["nvidia", "gemini", "mock"].map((name) => {
    const active = providerNames.includes(name);
    const row = el("li", "provider-row");
    row.append(
      el("span", `glow-dot ${active ? (name === "mock" ? "glow-warn" : "glow-good") : "glow-off"}`),
      el("span", "provider-name", name),
      el("span", "provider-meta", active ? roles[name] : "no key")
    );
    return row;
  });
  $("provider-list").replaceChildren(...rows);
}

/* Startup: read provider health for the sidebar, seed the occupancy history
   from simulated minutes, then start the telemetry poll. */
async function boot() {
  try {
    const health = await api("/api/health");
    providerNames = health.active_providers;
    renderProviders();
  } catch {
    $("phase-label").textContent = "api offline";
  }
  await Promise.all([
    seedHistory().catch(() => refreshCrowd()),
    populateNavigator().catch(() => {}),
  ]);
  setInterval(refreshCrowd, 10_000);
}

boot();
