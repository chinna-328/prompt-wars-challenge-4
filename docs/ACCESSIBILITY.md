# Accessibility

Accessibility here is two things: the **product feature** (getting less-mobile
fans through an 80,000-seat stadium) and the **interface quality** (usable by
diverse users and environments). StadiumIQ treats both as first-class.

## Accessibility as a product feature

- **Step-free routing.** `find_route(accessible=True)` drops every stairs edge
  from the graph; the route the fan receives is *verified* step-free, not
  best-effort. A test enforces that every seating section is reachable
  step-free from every gate — the guarantee can never silently regress.
- **Accessible POIs are map citizens:** accessible restrooms, elevator EL-3,
  first aid, and a sensory room are routable nodes, not footnotes.
- **Narrated directions** in the fan's language reduce dependence on visual
  signage — useful for low-vision fans and anyone who can't read local signs.
- **Ops briefings surface accessibility state** ("keep elevator EL-3 staffed
  through halftime") so venue staff maintain the accessible experience under load.

## Multilingual by default

All GenAI surfaces (chat, directions, briefings) operate in 10 languages
including RTL Arabic. Every surface that renders GenAI text — chat bubbles,
the briefing panel, narrated directions, and the chat input itself — carries
`dir="auto"`, so each piece of content picks its own base direction: Arabic
replies align right and punctuate correctly inside the otherwise LTR page.

## Interface accessibility (WCAG-conscious)

- **Semantic structure:** landmarks (`header/main/footer`), labeled sections
  (`aria-labelledby`), real form labels, a skip-to-content link.
- **Screen readers:** chat log, alert feed, briefing, and route results are
  `aria-live` regions; each chart bar carries an `aria-label` with name, value,
  and status; a full `<table>` alternative to the charts ships in the DOM.
- **Not color-alone:** zone status = color dot **+ icon + text label**
  (`✓ low`, `▲ high`); alerts pair severity color with icon and text.
- **Keyboard:** every interactive element is native (`button`, `select`,
  `input`) with a visible `:focus-visible` outline; chart bars are focusable
  and expose their tooltip content on focus.
- **Motion & preferences:** `prefers-reduced-motion` disables all animation;
  `color-scheme: dark` keeps native widgets consistent; layout is responsive
  down to phone widths (volunteers work on phones).
- **Contrast (computed, not eyeballed):** ink tokens #eef2fa / #b6c2d9 on the
  #0b1120 card surface measure 16.8:1 and 10.5:1 (≥ 4.5:1 required); series
  blue #3b82f6 measures 5.1:1 against the surface (≥ 3:1 for marks); button
  text is white on #2563eb at 5.2:1. Status hues are the reserved dataviz set,
  all ≥ 3:1 here, always paired with icon + label.
- **KPI micro-charts are annotated duplicates:** sparklines and the density
  donut are `aria-hidden` decorations of values that sit beside them as text,
  and the full data table remains the canonical non-visual view.
- **Step-free routing is the default:** the navigator's "step-free route only"
  toggle ships checked — accessible routing is opt-out, not opt-in.

## Environments

- Runs offline with zero keys (demo mode) — judgeable anywhere.
- No CDN dependencies: works on air-gapped venue networks.
- Three static files, no framework — usable on low-end devices and slow Wi-Fi.
