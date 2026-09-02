# KQL Quest

A 2D platformer that teaches Kusto Query Language. Run, jump, and solve real KQL
queries at terminals to unlock the exit. Runs entirely in the browser — no backend,
no Azure connection, no data leaves the page.

> Proof of concept. The goal is to prove the loop is fun and the teaching works
> before anyone invests in content at scale.

## The loop

Eight missions across two worlds, wrapped in a mystery: **Case 4417 — The Contoso
Spray**. Each correct query unlocks a barrier *and* reveals a piece of evidence.
By the last terminal the player has reconstructed a password-spray attack using
nothing but KQL. The menu keeps a running case file.

Borrowed deliberately from three teaching games:

| Idea | Source | Where it shows up |
| --- | --- | --- |
| Instant feedback while you type | Flexbox Froggy | Results re-run on a 320 ms debounce; the checklist ticks live |
| Explicit pass criteria next to the editor | Elevator Saga | The **Checks** panel: one row per learning objective, plus "result matches" |
| Narrative that rewards curiosity | SQL Murder Mystery | Evidence unlocked per query, assembled into a case file |

## Quick start

```powershell
npm install
npm run dev      # http://localhost:5173
```

```powershell
npm run build    # type-check + production bundle into dist/
npm test         # KQL engine + level integrity tests
```

## How it works

The game and the query engine are deliberately separate.

```
Phaser scene  --(player presses E at a terminal)-->  Monaco overlay
                                                          |
                                          player query ---+--- level.solution
                                                          |
                                              in-browser KQL interpreter
                                                          |
                                                  compare result sets
                                                          |
                                            solved -> gate opens, XP awarded
```

There is no KQL service call. `src/kql` is a small interpreter that runs a useful
subset of KQL against fixture tables held in memory:

- `where`, `project`, `project-away`, `extend`, `summarize`, `count`, `take`,
  `limit`, `top`, `sort`/`order by`, `distinct`, `search`, `let`, `render` (ignored)
- operators including `==`, `!=`, `<`, `>`, `contains`, `has`, `startswith`,
  `endswith`, `in`, `=~`, `and`, `or`
- functions including `count`, `countif`, `sum`, `avg`, `min`, `max`, `dcount`,
  `ago`, `now`, `bin`, `tolower`, `strcat`, `iff`, `isnotempty`, `toint`

### Two design decisions worth knowing

**Answers are computed, not hard-coded.** A level stores its own reference
`solution`. At grade time the engine runs both the player's query and the
reference solution, then compares the result sets. Change the fixture data and
every expected answer updates itself. A test asserts that every level is solved by
its own solution, so a broken level fails CI rather than a demo.

**The clock is frozen.** `SIM_NOW` in `src/data/tables.ts` pins "now" to a fixed
instant, so `ago(1d)` means the same thing forever and results never drift.

## Runs on anything with a browser

The canvas is sized manually rather than letterboxed, so the game fills whatever
screen it lands on:

- **Native resolution.** The backing store is CSS pixels multiplied by the device
  pixel ratio (capped at 2), so it is sharp on a phone and on a HiDPI monitor.
- **Resolution-aware camera.** `src/game/viewport.ts` picks a camera zoom that shows
  roughly 500 world pixels vertically and never less than 620 horizontally, so a
  laptop, an ultrawide and a phone all get a sensible amount of world in frame.
- **Orientation aware.** The menu has separate landscape and portrait layouts and
  rebuilds itself when the device rotates; the play scene re-zooms instantly and
  regenerates scenery only when the viewport really changed shape.
- **Touch controls.** Phones get an on-screen pad, JUMP, USE and a menu button.
  They appear only when the primary pointer is coarse, so a touch laptop with a
  mouse still gets the keyboard hints.
- **Keyboardless KQL.** The mission panel becomes Brief / Query / Result tabs on a
  phone, and a scrolling token keypad (`|`, `where`, `summarize`, `count()`, ...)
  lets you write every level solution without typing a character.
- The sky is a CSS gradient behind a transparent canvas and the HUD is DOM, so both
  stay perfectly crisp at any resolution.

Portrait works, but a side-scroller wants width — phones get a dismissible "turn
your phone sideways" prompt.

## Promo reel

`demo/kql-quest-reel.mp4` is a 1080x1920 (9:16) Instagram Reel of an automated
playthrough — menu, platforming, a mission solved, the evidence reveal.

```powershell
npx vite --port 5180 --strictPort   # the recorder needs the dev server
npm run reel
```

[tools/record-reel.mjs](tools/record-reel.mjs) drives a real playthrough in headless
Chromium, records it, and transcodes to H.264 MP4 with a silent audio track. Edit the
captions and beat timings in that file to re-cut it. It needs `playwright` and
`ffmpeg-static`, which are dev-only dependencies.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/kql/` | Tokenizer, parser, interpreter, result comparison. No DOM, no Phaser. |
| `src/data/tables.ts` | Seeded fixture tables: `SigninLogs`, `SecurityEvent`, `Heartbeat`, `Perf`. |
| `src/data/levels.ts` | Mission text, starter query, solution, hints, requirements, clue. |
| `src/engine/` | Grading and progress persistence. |
| `src/game/palette.ts` | Per-world colour palettes and gradient helpers. |
| `src/game/viewport.ts` | Resolution and zoom maths for every screen size. |
| `src/game/textures.ts` | Every sprite, drawn procedurally at boot. |
| `src/game/backdrop.ts` | Parallax scenery, foreground foliage, CSS sky. |
| `src/game/player.ts` | The avatar: detached hands and feet that chase the body with spring lag. |
| `src/game/virtualInput.ts` | Shared state for the on-screen controls. |
| `src/game/scenes/` | Boot, menu and play scenes. |
| `src/ui/` | Monaco overlay, HUD, touch controls, KQL syntax highlighting. |

All art is generated at runtime in `src/game/textures.ts` and `src/game/backdrop.ts`,
and all sound is synthesised in `src/game/sfx.ts`, so the repo carries no binary
assets. Changing a world's entire look is a matter of editing one palette entry.

## Adding a level

1. Add an entry to `LEVELS` in `src/data/levels.ts`. The `solution` field defines
   the expected answer, so it must actually run. `clue` is the story payload shown
   on success.
2. Add a terminal to the relevant world in `src/game/worldDefs.ts`:
   `{ x: <tile column>, levelId: '<your id>' }`.
3. Run `npm test`. The level integrity suite will tell you if the solution does
   not run, returns nothing, or is satisfied by the starter query.

`requires` is a list of regex checks run before results are compared. Use it to
enforce the teaching point — otherwise a player can reach the right numbers
without using the operator the mission is about.

## Adding a world

Add a `WorldDef` to `WORLD_DEFS` in `src/game/worldDefs.ts`. Terrain is a list of
spans with a surface row, or `null` for a pit. Keep gaps at 5 tiles or fewer and
climbs at 3 rows or fewer so every jump stays possible.

## Suggested split for a team of five

1. **Gameplay** — Phaser scenes, physics, controls, camera feel
2. **KQL runtime** — interpreter coverage, error messages, fixture data
3. **UI/UX** — Monaco integration, hints, results, accessibility, mobile
4. **Content** — levels, world layouts, mission writing, curriculum mapping
5. **Platform** — CI/CD, tests, telemetry, playtest coordination

The level JSON schema is the contract between roles 1, 2 and 4 — agree on it
before parallelising.

## Deployment

**Live:** https://el-bakkali.github.io/kql-quest/

Hosted on GitHub Pages. `.github/workflows/deploy.yml` runs the tests, builds the
bundle, and publishes `dist/` on every push to `main`. Pages is configured with
**Settings > Pages > Source: GitHub Actions**.

The Vite `base` is `'./'`, so the bundle uses relative asset paths and works from a
project subpath (`/kql-quest/`) without any extra configuration.

### Deploying somewhere else

The build output is a plain static site with no backend, so `dist/` can be dropped
on any static host:

```powershell
npm run build
```

GitHub Pages is not an option here because the repository is private.

## Known gaps

- `join`, `union`, `mv-expand`, `parse` and `make-series` are not implemented
- `take` returns the first N rows; real KQL makes no ordering guarantee
- Progress is per-browser via `localStorage`; there is no leaderboard yet

## Credit

Curriculum structure follows the
[Must Learn KQL](https://aka.ms/MustLearnKQL) series by Rod Trent (MIT licensed).
Mission text and fixture data here are original; no content is copied from the
series or its book.
