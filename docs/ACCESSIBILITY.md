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
including RTL Arabic — the browser's bidi handling renders RTL replies
correctly because text is inserted as plain text nodes.

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
- **Contrast:** ink tokens (#fff / #c3c2b7 on #1a1a19) exceed 4.5:1; the
  palette follows a CVD-validated reference (categorical blue, reserved status
  hues with icon+label mitigation).

## Environments

- Runs offline with zero keys (demo mode) — judgeable anywhere.
- No CDN dependencies: works on air-gapped venue networks.
- Three static files, no framework — usable on low-end devices and slow Wi-Fi.
