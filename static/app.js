/* StadiumIQ dashboard.
   Plain ES modules-free JS, no build step. All dynamic text is inserted via
   textContent / createElement — never innerHTML — so API/LLM output cannot
   inject markup (XSS-safe by construction). SVG marks are built with
   createElementNS + attributes; styling stays in the stylesheet (strict CSP). */
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

const STATUS_ICONS = { low: "✓", moderate: "•", high: "▲", critical: "⛔" };

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

/* ---------------- Tooltip ---------------- */

const tooltip = $("tooltip");

/* One shared tooltip node, repositioned per target. Shows on hover *and*
   keyboard focus so the chart details are reachable without a mouse. */
function attachTooltip(el, title, body) {
  const show = (event) => {
    tooltip.replaceChildren();
    const t = document.createElement("div");
    t.className = "tt-title";
    t.textContent = title;
    const b = document.createElement("div");
    b.className = "tt-body";
    b.textContent = body;
    tooltip.append(t, b);
    tooltip.hidden = false;
    position(event);
  };
  const position = (event) => {
    const pad = 14;
    const x = Math.min(event.clientX + pad, window.innerWidth - tooltip.offsetWidth - pad);
    const y = Math.min(event.clientY + pad, window.innerHeight - tooltip.offsetHeight - pad);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };
  el.addEventListener("mouseenter", show);
  el.addEventListener("mousemove", position);
  el.addEventListener("mouseleave", () => (tooltip.hidden = true));
  el.addEventListener("focus", () => show({ clientX: 40, clientY: 40 }));
  el.addEventListener("blur", () => (tooltip.hidden = true));
}

/* ---------------- KPI micro-viz (SVG, real telemetry) ---------------- */

const HISTORY_LIMIT = 24;
const occupancyHistory = [];
const gateWaitHistory = [];

/* Append a sample, capping the series at the sparkline's window size. */
function pushHistory(series, value) {
  series.push(value);
  if (series.length > HISTORY_LIMIT) series.shift();
}

/* Sparkline over a rolling window of poll samples. Decorative duplicate of
   the numbers beside it (aria-hidden); the table view carries the data. */
function drawSparkline(svgId, values) {
  const svg = $(svgId);
  svg.replaceChildren();
  if (values.length < 2) return;
  const w = 120;
  const h = 36;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const joined = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const area = document.createElementNS(SVG_NS, "polygon");
  area.setAttribute("class", "spark-area");
  area.setAttribute("points", `${pad},${h - pad} ${joined} ${(pad + (values.length - 1) * step).toFixed(1)},${h - pad}`);

  const line = document.createElementNS(SVG_NS, "polyline");
  line.setAttribute("class", "spark-line");
  line.setAttribute("points", joined);

  const [lastX, lastY] = pts[pts.length - 1];
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("class", "spark-dot");
  dot.setAttribute("cx", lastX.toFixed(1));
  dot.setAttribute("cy", lastY.toFixed(1));
  dot.setAttribute("r", "2.5");

  svg.append(area, line, dot);
}

/* Density donut: the SVG circle has pathLength=100, so the dasharray is
   simply "<percent> <remainder>" — no circumference math needed. */
function drawDonut(percent) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  $("donut-fill").setAttribute("stroke-dasharray", `${clamped} ${100 - clamped}`);
  $("donut-text").textContent = `${clamped}%`;
}

/* Tint the alert KPI's shield icon by the worst active severity. */
function setAlertShield(alerts) {
  const shield = $("alert-shield");
  const critical = alerts.some((a) => a.severity === "critical");
  shield.classList.toggle("shield-critical", critical);
  shield.classList.toggle("shield-alert", !critical && alerts.length > 0);
}

/* ---------------- Bar chart builder ---------------- */

/* One labeled, focusable bar. The track carries role="img" + aria-label so
   screen readers get name, value, and status without parsing the visuals. */
function barRow({ name, fraction, valueLabel, status, tooltipBody }) {
  const row = document.createElement("div");
  row.className = "bar-row";

  const label = document.createElement("div");
  label.className = "bar-label";
  const nameEl = document.createElement("span");
  nameEl.className = "bar-name";
  nameEl.textContent = name;
  label.append(nameEl);
  if (status) {
    const chip = document.createElement("span");
    chip.className = `bar-status status-${status}`;
    const dot = document.createElement("span");
    dot.className = "status-dot";
    chip.append(dot, document.createTextNode(`${STATUS_ICONS[status] || ""} ${status}`));
    label.append(chip);
  }

  const track = document.createElement("div");
  track.className = "bar-track";
  track.tabIndex = 0;
  track.setAttribute("role", "img");
  track.setAttribute("aria-label", `${name}: ${valueLabel}${status ? `, ${status}` : ""}`);

  const fill = document.createElement("div");
  fill.className = "bar-fill";
  fill.style.width = `${Math.min(100, Math.round(fraction * 100))}%`;
  track.append(fill);
  attachTooltip(track, name, tooltipBody);

  const value = document.createElement("span");
  value.className = "bar-value";
  value.textContent = valueLabel;

  row.append(label, track, value);
  return row;
}

/* ---------------- Crowd dashboard ---------------- */

/* Render one telemetry snapshot everywhere it appears: KPI tiles, micro-viz,
   both bar charts, the accessible table view, and the alert feed. */
function renderCrowd(snapshot) {
  $("phase-label").textContent =
    `${PHASE_LABELS[snapshot.phase] || snapshot.phase} · min ${snapshot.match_minute}`;

  // KPIs
  const totalOcc = snapshot.zones.reduce((sum, z) => sum + z.occupancy, 0);
  const totalCap = snapshot.zones.reduce((sum, z) => sum + z.capacity, 0);
  $("kpi-occupancy").textContent = totalOcc.toLocaleString();
  $("kpi-occupancy-hint").textContent =
    `${Math.round((totalOcc / totalCap) * 100)}% of concourse capacity`;

  const busiest = [...snapshot.zones].sort((a, b) => b.density - a.density)[0];
  $("kpi-busiest").textContent = busiest.name;
  $("kpi-busiest-hint").textContent =
    `${Math.round(busiest.density * 100)}% full · ${busiest.status}`;

  const fastest = [...snapshot.gates].sort((a, b) => a.wait_minutes - b.wait_minutes)[0];
  $("kpi-gate").textContent = fastest.name;
  $("kpi-gate-hint").textContent = `≈ ${fastest.wait_minutes} min wait`;

  $("kpi-alerts").textContent = String(snapshot.alerts.length);
  const critical = snapshot.alerts.filter((a) => a.severity === "critical").length;
  $("kpi-alerts-hint").textContent =
    critical ? `${critical} critical` : snapshot.alerts.length ? "warnings only" : "all clear";

  // KPI micro-viz
  pushHistory(occupancyHistory, totalOcc);
  pushHistory(gateWaitHistory, fastest.wait_minutes);
  drawSparkline("spark-occupancy", occupancyHistory);
  drawSparkline("spark-gate", gateWaitHistory);
  drawDonut(busiest.density * 100);
  setAlertShield(snapshot.alerts);

  // Zone chart
  const zoneChart = $("zone-chart");
  zoneChart.replaceChildren(
    ...snapshot.zones.map((z) =>
      barRow({
        name: z.name,
        fraction: z.density,
        valueLabel: `${Math.round(z.density * 100)}%`,
        status: z.status,
        tooltipBody: `${z.occupancy.toLocaleString()} / ${z.capacity.toLocaleString()} fans · ${z.status}`,
      })
    )
  );

  // Gate chart
  const maxWait = Math.max(1, ...snapshot.gates.map((g) => g.wait_minutes));
  $("gate-chart").replaceChildren(
    ...snapshot.gates.map((g) =>
      barRow({
        name: g.name,
        fraction: g.wait_minutes / maxWait,
        valueLabel: `${g.wait_minutes} min`,
        tooltipBody: `${g.queue_length} in queue · ${g.throughput_per_min} fans/min throughput`,
      })
    )
  );

  // Gate table view (canonical non-visual reading of the gate chart)
  $("gate-table").querySelector("tbody").replaceChildren(
    ...snapshot.gates.map((g) => {
      const tr = document.createElement("tr");
      for (const text of [
        g.name,
        `${g.queue_length.toLocaleString()} fans`,
        `${g.wait_minutes} min`,
        `${g.throughput_per_min} fans/min`,
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    })
  );

  // Zone table view
  const tbody = $("crowd-table").querySelector("tbody");
  tbody.replaceChildren(
    ...snapshot.zones.map((z) => {
      const tr = document.createElement("tr");
      for (const text of [
        z.name,
        `${z.occupancy.toLocaleString()} / ${z.capacity.toLocaleString()}`,
        `${Math.round(z.density * 100)}%`,
        z.status,
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    })
  );

  // Alert feed
  const feed = $("alert-feed");
  if (!snapshot.alerts.length) {
    const li = document.createElement("li");
    li.className = "alert-empty";
    li.textContent = "✓ No active alerts — venue nominal.";
    feed.replaceChildren(li);
  } else {
    feed.replaceChildren(
      ...snapshot.alerts.map((a) => {
        const li = document.createElement("li");
        li.className = `alert${a.severity === "critical" ? " alert-critical" : ""}`;
        const icon = document.createElement("span");
        icon.className = "alert-icon";
        icon.textContent = a.severity === "critical" ? "⛔" : "⚠️";
        const body = document.createElement("div");
        const msg = document.createElement("p");
        msg.textContent = a.message;
        const action = document.createElement("p");
        action.className = "alert-action";
        action.textContent = a.recommendation;
        body.append(msg, action);
        li.append(icon, body);
        return li;
      })
    );
  }

  const stamp = new Date().toLocaleTimeString();
  $("crowd-updated").textContent = `updated ${stamp}`;
  $("gates-updated").textContent = `updated ${stamp}`;
  $("sys-updated").textContent = stamp;

  // System badge: title, detail, and icon tint must always agree — the text
  // carries the state (never color alone) and the color merely echoes it.
  const warnings = snapshot.alerts.length - critical;
  let sysTitle = "All systems";
  let sysSub = "operational";
  if (critical) {
    sysTitle = "Critical alerts";
    sysSub = `${critical} critical · ${warnings} warning${warnings === 1 ? "" : "s"}`;
  } else if (snapshot.alerts.length) {
    sysTitle = "Advisories active";
    sysSub = `${snapshot.alerts.length} warning${snapshot.alerts.length === 1 ? "" : "s"}`;
  }
  $("sys-status").textContent = sysTitle;
  $("sys-substatus").textContent = sysSub;
  const sysIcon = document.querySelector(".sys-icon");
  sysIcon.classList.toggle("sys-icon-critical", critical > 0);
  sysIcon.classList.toggle("sys-icon-alert", critical === 0 && snapshot.alerts.length > 0);
}

/* 10-second poll of the unmetered telemetry endpoint (never the LLM ones). */
async function refreshCrowd() {
  try {
    const started = performance.now();
    const snapshot = await api("/api/crowd/status");
    $("latency").textContent = `${Math.max(1, Math.round(performance.now() - started))} ms`;
    renderCrowd(snapshot);
  } catch {
    $("phase-label").textContent = "telemetry offline";
    $("sys-substatus").textContent = "telemetry offline";
  }
}

/* Seed the sparklines with the minutes leading up to "now" — telemetry is a
   deterministic function of the match clock, so history is queryable. */
async function seedHistory() {
  const started = performance.now();
  const current = await api("/api/crowd/status");
  $("latency").textContent = `${Math.max(1, Math.round(performance.now() - started))} ms`;
  const minute = current.match_minute;
  const minutes = [];
  for (let m = minute - 14; m < minute; m += 2) {
    if (m >= -90) minutes.push(m);
  }
  const snapshots = await Promise.all(
    minutes.map((m) => api(`/api/crowd/status?match_minute=${m}`).catch(() => null))
  );
  for (const snap of snapshots) {
    if (!snap) continue;
    pushHistory(occupancyHistory, snap.zones.reduce((s, z) => s + z.occupancy, 0));
    const fastest = [...snap.gates].sort((a, b) => a.wait_minutes - b.wait_minutes)[0];
    pushHistory(gateWaitHistory, fastest.wait_minutes);
  }
  renderCrowd(current);
}

/* ---------------- Router (hash-based pages) ---------------- */

/* Client-side routing with zero dependencies: each sidebar item is a real
   page at #/<name>, so browser back/forward and deep links work. On
   navigation we set document.title and move focus to the page heading
   (tabindex="-1") so screen readers announce the change. */
const ROUTES = {
  "#/overview": { view: "view-overview", title: "Overview" },
  "#/crowd": { view: "view-crowd", title: "Crowd intelligence" },
  "#/gates": { view: "view-gates", title: "Gate management" },
  "#/briefings": { view: "view-briefings", title: "AI briefings" },
  "#/alerts": { view: "view-alerts", title: "Alerts" },
  "#/assistant": { view: "view-assistant", title: "Assistant" },
  "#/navigator": { view: "view-navigator", title: "Step-free navigator" },
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
  document.title = `${route.title} · StadiumIQ`;
  window.scrollTo(0, 0);
  if (focus) document.querySelector(`#${route.view} .page-title`).focus();
}

window.addEventListener("hashchange", () => showPage(location.hash));
showPage(location.hash, { focus: false }); // initial load: never steal focus

/* ---------------- Ops briefing ---------------- */

$("briefing-btn").addEventListener("click", async () => {
  const btn = $("briefing-btn");
  const out = $("briefing-output");
  btn.disabled = true;
  btn.textContent = "Generating…";
  try {
    const data = await api("/api/ops/briefing", {
      method: "POST",
      body: JSON.stringify({ language: language() }),
    });
    out.replaceChildren();
    out.append(document.createTextNode(data.briefing));
    const tag = document.createElement("span");
    tag.className = "provider-tag";
    tag.textContent = `generated by ${data.provider} · ${data.model} · ${data.phase}`;
    out.append(document.createElement("br"), tag);
  } catch (err) {
    out.replaceChildren();
    const p = document.createElement("p");
    p.className = "error-note";
    p.textContent = `Could not generate briefing: ${err.message}`;
    out.append(p);
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
  const div = document.createElement("div");
  div.className = `msg msg-${kind}`;
  const p = document.createElement("p");
  // dir="auto" lets each bubble pick its direction from its own content,
  // so RTL (Arabic) replies align correctly in an otherwise LTR page.
  p.setAttribute("dir", "auto");
  p.textContent = text;
  div.append(p);
  if (meta) {
    const m = document.createElement("span");
    m.className = "msg-meta";
    m.textContent = meta;
    div.append(m);
  }
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
    const meta = document.createElement("span");
    meta.className = "msg-meta";
    meta.textContent = `${data.provider} · ${data.model}`;
    pending.append(meta);
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

/* ---------------- Navigator ---------------- */

/* Fill both origin/destination selects from the venue map, alphabetized,
   with a sensible default journey (arrival gate → a seating section). */
async function populateNavigator() {
  const map = await api("/api/stadium/map");
  $("venue-name").textContent = `${map.venue}`;
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
}

$("nav-swap").addEventListener("click", () => {
  const origin = $("nav-origin");
  const destination = $("nav-destination");
  [origin.value, destination.value] = [destination.value, origin.value];
});

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

    const summary = document.createElement("div");
    summary.className = "route-summary";
    const dist = document.createElement("span");
    dist.append("Distance: ");
    const distStrong = document.createElement("strong");
    distStrong.textContent = `${data.total_meters} m`;
    dist.append(distStrong);
    const time = document.createElement("span");
    time.append("Walk: ");
    const timeStrong = document.createElement("strong");
    timeStrong.textContent = `≈ ${data.est_minutes} min`;
    time.append(timeStrong);
    summary.append(dist, time);
    if (data.accessible) {
      const acc = document.createElement("span");
      acc.textContent = "♿ step-free verified";
      summary.append(acc);
    }
    out.append(summary);

    const steps = document.createElement("ol");
    steps.className = "route-steps";
    data.steps.forEach((step) => {
      const li = document.createElement("li");
      li.textContent = step.name;
      if (step.meters_from_previous > 0) {
        const m = document.createElement("span");
        m.className = "step-meters";
        m.textContent = ` — ${step.meters_from_previous} m`;
        li.append(m);
      }
      steps.append(li);
    });
    out.append(steps);

    if (data.directions) {
      const dir = document.createElement("div");
      dir.className = "route-directions";
      // Narration follows the fan's language; render bidi-safe like chat.
      dir.setAttribute("dir", "auto");
      dir.textContent = data.directions;
      out.append(dir);
      const tag = document.createElement("span");
      tag.className = "provider-tag";
      tag.textContent = `narrated by ${data.provider}`;
      out.append(tag);
    }
  } catch (err) {
    out.replaceChildren();
    const p = document.createElement("p");
    p.className = "error-note";
    p.textContent = err.message;
    out.append(p);
  } finally {
    btn.disabled = false;
    btn.textContent = "Find route";
  }
});

/* ---------------- Boot ---------------- */

/* Startup: read provider health for the header/footer badges, seed the
   sparklines from simulated history, then start the telemetry poll. */
async function boot() {
  try {
    const health = await api("/api/health");
    const chain = health.active_providers.join(" → ");
    $("provider-label").textContent = chain;
    $("footer-chain").textContent =
      health.active_providers.length === 1 && health.active_providers[0] === "mock"
        ? `${chain} · offline demo mode`
        : `${chain} · live GenAI`;
  } catch {
    $("provider-label").textContent = "api offline";
    $("sys-substatus").textContent = "api offline";
  }
  await Promise.all([
    seedHistory().catch(() => refreshCrowd()),
    populateNavigator().catch(() => {}),
  ]);
  setInterval(refreshCrowd, 10_000);
}

boot();
