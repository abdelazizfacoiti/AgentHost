# Web research: check the local news on Hespress

A real run against this repo's tool stack: focus Firefox, search, click
through to hespress.com, and verify the homepage from a screenshot. Every
step below is a real MCP tool call in order (state-changing steps use a
`dryRun` preview first, then execute with the returned confirmation token).

## The exact sequence

1. `window.list` — find the Firefox window id.
2. `window.focus { windowId }` (dry-run, then execute) — windowId-only focus
   skips the full window listing; the token binds the exact id.
3. `desktop.hotkey { keys: ["ctrl", "t"] }` — new tab.
4. `desktop.type_text { text: "hespress" }` — ASCII goes direct via xdotool.
5. `desktop.hotkey { keys: ["Enter"] }` — submit the search.
6. `desktop.screenshot` — ground the first suggestion row from the image.
7. `desktop.click { x: 970, y: 130 }` — a highlight ring flashes at the point
   while the click fires (automatic narration, no extra call needed).
8. `desktop.screenshot` — read the Google results.
9. `desktop.click { x: 530, y: 365 }` — the Hespress result link.
10. `desktop.screenshot` — homepage verified, headlines collected.

Pass `activeWindow: { windowId }` (id only) on every desktop step: titles
change on navigation, and id-only context keeps matching.

## What this run looks like

Google results for "hespress", first hit hespress.com:

![Google results for hespress](../../.github/assets/demo-search-results.png)

Hespress homepage after the click:

![Hespress homepage](../../.github/assets/demo-hespress-home.png)

## What the operator sees live

While the agent works, the on-screen working widget narrates each step —
`Sending hotkey ctrl+t`, `Typing text 8 chars`, `Clicking target (970, 130)`
— and every click flashes a highlight ring at its target. See
`../overlay-narration/` for details.

## Notes from this run

- Live-testing this exact flow exposed and fixed two real backend bugs:
  chained `xdotool getactivewindow` printing (pid misread as window id) and
  wmctrl-hex vs xdotool-decimal id mismatch. Both are covered by regression
  tests in `packages/os-linux/src/__tests__/desktop.test.ts`.
- Typing a full URL needs a clipboard backend (`xclip`/`xsel`) for `.` and
  `/`; searching the site name needs letters only, so it works everywhere.
