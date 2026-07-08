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
- **Screen-reader-aware routing:** the seven pages are hash routes; each
  navigation updates `document.title`, marks the sidebar link
  `aria-current="page"`, and moves focus to the page heading
  (`tabindex="-1"`) so the change is announced. Browser back/forward and
  deep links work because routes are real URL fragments.
- **Screen readers:** chat log, alert feed, briefing feed, and route results
  are `aria-live` regions; zone and gate data ship as real `<table>` elements
  (first-class cards, not hidden alternatives).
- **Not color-alone:** every color-coded state carries its word — bowl cells
  print the status label under the percentage, gate and zone statuses are
  text tags, alerts pair the severity dot with a "Critical"/"Warning" tag,
  and the bowl legend names each hue.
- **Keyboard:** every interactive element is native (`button`, `select`,
  `input`, `a`) with a visible `:focus-visible` outline.
- **Motion & preferences:** `prefers-reduced-motion` disables all animation
  (including the LIVE pulse and page transitions); `color-scheme: dark` keeps
  native widgets consistent; layout is responsive down to phone widths
  (volunteers work on phones).
- **Contrast (computed, not eyeballed):** on the #0f1520 card surface, ink
  #e8edf4 = 15.5:1 and body #aeb7c4 = 9.0:1; muted text was **lifted from the
  source design's #6b7688 (3.98:1, fails) to #7c8798 (5.0:1, passes)**; accent
  green #34d17e = 9.2:1, amber = 9.0:1, red = 4.9:1, blue = 5.0:1 (all ≥ 4.5:1
  even at tag sizes); button/bubble text #08160f on the green gradient = 9.3:1.
- **The occupancy sparkline is an annotated duplicate:** it is `aria-hidden`
  decoration of the live percentage that sits beside it as text, and the zone
  table remains the canonical non-visual view.
- **Step-free routing is the default:** the navigator's "step-free route only"
  toggle ships checked — accessible routing is opt-out, not opt-in.

## Environments

- Runs offline with zero keys (demo mode) — judgeable anywhere.
- No CDN dependencies: fonts are self-hosted woff2 subsets (56 KB,
  `font-display: swap` so text renders immediately) — works on air-gapped
  venue networks.
- Three code files plus fonts, no framework — usable on low-end devices and
  slow Wi-Fi.
