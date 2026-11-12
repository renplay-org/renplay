---
name: ui-check
description: Check Renplay UI changes on a phone and a desktop before calling them done. Runs the app (or points the dev UI at a deployed server), takes screenshots with Playwright in WebKit (iPhone) and Chromium, and reviews them against the product rules. Use after any change to selector/ or the player.
---

# Check the UI on a phone and a desktop

## 1. Focus while working, accept once at the end

While working, run only the tests a change touches in the pinned Playwright Linux container.
Use `--warm` to start a container for this worktree once and reuse it with `docker exec`. It syncs
source changes and deletions, installs dependencies only when their lockfile changed, and reuses
the library build until its inputs change, including shared server types.

Run the whole suite once at the end with `mise run test:ui`, and push only after it passes. It runs
the library browser checks and website/docs layout checks in the pinned official Playwright Linux
container with Node 24 and matching package versions. Only this container run counts for acceptance.
Never re-run a passing suite to make sure. A doubt about a test is a flake to report, not a reason
to repeat acceptance. Native Mac browsers below are for quick tries and visual review, not acceptance.

The Playwright suite uses one worker, desktop Chromium at 1440 px, and touch WebKit at 390 by 844 px and
844 by 390 px. JSON, timings and retained failure traces are in `ui-test-results/`. Read the text
or JSON failure first, then the trace. A pass only on retry warns locally and fails CI. Never
point the suite at a real library. No screenshots in pull requests.

For app changes, choose the affected behavior explicitly:
`sh scripts/test-ui.sh --warm playwright --project=chromium-desktop --grep 'Library: address'`.
For test or imported helper changes, use
`sh scripts/test-ui.sh --warm playwright --only-changed=origin/dev` after fetching `origin/dev`.
Playwright follows test imports, not the app's built assets, so this is not a selector for app changes.
Re-run just the last failures with `sh scripts/test-ui.sh --warm playwright --last-failed`.
For one older subject, use `sh scripts/test-ui.sh --warm legacy --only search`.
Stop the warm container with `mise run test:ui:stop`. Results, including the last-failed state, stay
in `ui-test-results/` across container runs.

For repeats without retries, use the **Flake hunt** workflow on your branch. Its repeat count
defaults to 10. It also runs nightly against `dev`. The older checks keep every run's log, and
Playwright uses `--repeat-each` with `--retries=0`. Each job's summary lists every test that failed
at least once, with reports and failure traces in its artifacts. Repeats belong there, not in the
working loop. The normal complete suite has a five minute budget, including the old checks.

Never loosen a test without stopping to report it and getting a maintainer's approval. Do not remove assertions,
widen tolerances, add or lengthen fixed waits, skip, quarantine, or change a test only to make it
pass. A migrated assertion must have equivalent or stronger coverage in the new runner.

## 2. Run the app for visual review

Either the full local stack (see AGENTS.md › Commands), or the dev UI against a deployed server
when the change is UI-only:

```sh
cd selector && RENPLAY_BACKEND=https://renplay.example npm run dev   # http://localhost:5199
```

The screenshot script never changes the server: every request other than GET is answered locally.
Keep it that way in any ad-hoc Playwright script too, because the backend may hold real saves.

## 3. Take screenshots

```sh
cd server
npx playwright install chromium webkit     # once
npm run screenshots -- http://localhost:5199 /tmp/shots [game-id] [--sfw]
```

`--sfw` hides pictures of adult games (title cards and scene cards, Renplay's own setting, which is also the default in a browser with no stored preference). Use it for every screenshot that is
published anywhere (docs, the website, issues, pull requests).

It captures the library, a game page, details, catalog and settings on a 1440×900 desktop, the
library and a game page on an iPhone 15 Pro in portrait, and the player in landscape. It exits
non-zero on page errors.

For a change in a specific flow, write a short Playwright script for it (WebKit with
`devices['iPhone 15 Pro']`, and swap width and height for landscape).

## 4. Review against the rules

Look at every screenshot, not only the one you changed:

- Nothing overflows or overlaps at 390 px wide; tap targets are at least about 40 px.
- No hover-only controls on touch screens.
- Sentence case everywhere: "Renplay", "Installed", capitalized tags, no lowercase line starts
  (also after "·"), no all-caps labels.
- No editable title, tags, cover or save folder (they come from the catalog).
- Text is short, plain and in full sentences.

What emulation cannot show: real safe-area insets (camera cutout, home indicator), Add to Home
Screen behavior, and Safari's toolbars. For player changes, ask the maintainer to try it on a real
phone and say what to look at.
