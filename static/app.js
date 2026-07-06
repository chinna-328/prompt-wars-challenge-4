/* StadiumIQ dashboard.
   Plain ES modules-free JS, no build step. All dynamic text is inserted via
   textContent / createElement — never innerHTML — so API/LLM output cannot
   inject markup (XSS-safe by construction). */
"use strict";

const $ = (id) => document.getElementById(id);
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
  el.addEventListener("focus", (e) => show({ clientX: 40, clientY: 40 }));
  el.addEventListener("blur", () => (tooltip.hidden = true));
}

/* ---------------- Bar chart builder ---------------- */

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

  // Table view
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

  $("crowd-updated").textContent = `updated ${new Date().toLocaleTimeString()}`;
}

async function refreshCrowd() {
  try {
    renderCrowd(await api("/api/crowd/status"));
  } catch {
    $("phase-label").textContent = "telemetry offline";
  }
}

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
    btn.textContent = "Generate briefing";
  }
});

/* ---------------- Fan assistant chat ---------------- */

function addMessage(kind, text, meta) {
  const log = $("chat-log");
  const div = document.createElement("div");
  div.className = `msg msg-${kind}`;
  const p = document.createElement("p");
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

async function boot() {
  try {
    const health = await api("/api/health");
    $("provider-label").textContent = health.active_providers.join(" → ");
  } catch {
    $("provider-label").textContent = "api offline";
  }
  await Promise.all([refreshCrowd(), populateNavigator().catch(() => {})]);
  setInterval(refreshCrowd, 10_000);
}

boot();
