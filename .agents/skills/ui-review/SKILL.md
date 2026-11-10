---
name: ui-review
description: Audit Renplay's interfaces as a demanding user and designer would, and write a ranked list of findings with evidence. Covers the app (selector/ and the player), the website (website/), the docs (docs/site) and catalog.renplay.org. Use when asked to review the UI, find what feels off, or before a release or a launch. For checking one change, use ui-check instead.
---

# Review the interfaces

The goal is a list of findings that a worker can fix one by one, each with its evidence. Look first, then
measure, then write. Never change code during a review.

## 1. Know the rules

Read `AGENTS.md` (the product rules: phones at 390 px, touch only, sentence case, plain copy, the adult
levels, safe for work on GitHub) and the design system in `selector/src/lantern/`. A finding that breaks a
product rule ranks above one that is a matter of taste.

## 2. Look at every surface

For each surface, open it in Playwright at **390 x 844 in WebKit** (iPhone, `hasTouch`, `isMobile`) and at
**1440 x 900 in Chromium**, in portrait and, for the app's player, in landscape. Take screenshots with
`--sfw` where the app offers it, and never publish a picture of an adult game.

- **App:** Library, Catalog, a game page, Add games, Settings (each panel), Activity, Account, Users, the
  player (loading, playing, the drawer), sign-in. Use the `ui-check` skill to run it.
- **Website** (`website/`): the home page, the catalog browser, every link in the header and the footer.
- **Docs** (`docs/site`): the home page, a guide, the configuration page, search.
- **catalog.renplay.org** and **engines.renplay.org**: what a person sees who opens them in a browser.

## 3. Measure what the eye misses

- **Layout shift.** Record Cumulative Layout Shift with a `PerformanceObserver` for `layout-shift` from
  the first byte until the page is still for 2 seconds, then while scrolling and while images arrive. Anything
  over 0.02 on a page is a finding: say which element moved and why (an image without a size, a font swap,
  content that arrives late without a placeholder of its size).
- **Transitions.** Click into a game from each grid and go back (the back button, the browser's back, a
  two-finger swipe on a trackpad where the browser supports it). The artwork should travel to its place and
  back without changing shape or jumping. Record a video (`recordVideo`) and look at it frame by frame.
- **Grids.** At every width between 360 and 1920 px in steps of 40, count the tiles in the last row of each
  paged grid. A last row that is mostly empty on a page boundary is a finding.
- **Scroll memory.** Scroll far down a long list, open an item, go back: the list must be where it was.
- **Touch.** Every control reachable and at least 44 px tall, nothing that needs a hover, no gesture that
  scrolls the page when it should move something inside it.
- **Speed.** Time to the first useful content on a cold load, on a throttled connection (Playwright CDP
  `Network.emulateNetworkConditions`, 4G).
- **Accessibility.** Run axe (`@axe-core/playwright`) on each page: contrast, labels, focus order, and
  keyboard use on the desktop.
- **Search engines** (public pages only): title, description, canonical address, Open Graph and Twitter
  cards, `robots.txt`, a sitemap, structured data where it fits, a favicon, and a real page (not only a
  redirect) at each host's root.

## 4. Judge as a person would

For each surface ask: what is this page for, and does it say so in the first screen? What does a new
visitor do next? What is there twice, or is decoration without a job? What would a person who does not
want adult games see, and a person who does? Does it look like one product across the app, the website and
the docs?

## 5. Write the findings

One Markdown file (the user says where, else `ui-review.md` beside the screenshots), findings ranked:

1. **Broken**: does not work, breaks a product rule, or shows what it must not.
2. **Jarring**: layout shift, a jump, a transition that changes shape, a lost scroll position.
3. **Confusing**: a person would not know what to do or what something means.
4. **Polish**: everything else.

Each finding: the surface and the width, what is wrong in one sentence, the evidence (a screenshot path, a
number, a frame), and a suggested fix in one or two sentences. Group findings that share one cause. End
with the three changes that would help most.
