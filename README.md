# GlitchBox — A Puzzle That Learns Your Playstyle

> Every Mind Has a Pattern. Every Puzzle Has a Way.

GlitchBox is a browser-based mystery puzzle game built for **InnoTech ’26**. It watches *how* a player solves — attempts, time, hints — and changes the **format of the next clue** and the **difficulty of the next room**. Two players can start from the same puzzle and end up on different paths.

Adaptation uses transparent, rule-based JavaScript. There is no trained AI model, no external API and no backend. Progress is saved only in the browser (LocalStorage).

---

## Run it

There is no build step and no dependencies.

**Option A — open the file:** double-click `index.html`. It uses classic `<script>` tags and makes no network requests for game data, so it runs from `file://`.

**Option B — local server:** recommended for demos, since it gives a cleaner URL and reliable LocalStorage.

```bash
cd glitchbox
python3 -m http.server 5180
```

Then open <http://localhost:5180>.

**Logic tests** (Node 18+, no packages):

```bash
node tests/run-tests.js
```

Fonts load from Google Fonts. Offline, the page falls back to system fonts and still works.

---

## Architecture

```
index.html              screens + dialogs (semantic HTML)
styles.css              design system, layouts, animations, responsive + reduced-motion
js/puzzles.js           11 puzzles: content, parse/validate, diagnosis, 3 hint levels + alt format
js/adaptiveEngine.js    RULES + PATHS, outcome classification, hint selection, next-room choice
js/sessionManager.js    player records, pausable clocks, LocalStorage save/load
js/game.js              DOM-free controller: submit, requestHint, advance, stats, insights
js/ui.js                Chamber component, panels, route map, compare board, completion, report
js/demo.js              scripted RUN DEMO (simulated players on a virtual clock)
js/app.js               routing, solo/compare flows, persistence hooks, dialogs, sound
tests/run-tests.js      50 Node tests for puzzles, engine, controller and persistence
```

Data flows one way: **UI → `GB.game` → `GB.engine` → state → UI re-render**. The engine and controller never touch the DOM, which is why they can be tested in Node.

---

## Puzzle library

| ID | Room / branch | Category | Lvl | Interaction |
|---|---|---|---|---|
| `seq-doubling` | 01 · shared start | Number Sequence | 2 | number |
| `seq-steps` | 02 · Guided | Number Sequence | 1 | number |
| `vis-growth` | 02 · Guided (alt) | Visual Pattern | 1 | choice |
| `odd-squares` | 03 · Guided | Odd One Out | 2 | choice |
| `rule-sides` | 03 · Guided (alt) | Rule-Based Pattern | 1 | number |
| `order-agents` | 04 · Guided | Ordering & Sequencing | 3 | tap-to-order |
| `final-guided` | 05 · Guided | Multi-Step Reasoning | 3 | 3-digit code |
| `seq-pronic` | 02 · Challenge | Number Sequence | 4 | number |
| `cipher-shift` | 03 · Challenge | Code Decoding | 4 | text |
| `logic-servers` | 04 · Challenge | Logical Deduction | 5 | choice |
| `final-challenge` | 05 · Challenge | Multi-Step Reasoning | 5 | 4-digit code |

Each puzzle has:
- a format parser (invalid input never costs an attempt);
- an answer check;
- a `diagnose()` that turns common wrong answers into targeted feedback (e.g. *"24 = 16 + 8: you repeated the last gap"*, *"Clue C1 isn't satisfied"*);
- three hint levels;
- one alternate-format clue (visual bars, step ladder, corner-marked shapes, alphabet strip, assumption tree, substitution table);
- an explanation shown after solving.

Tests check that every puzzle has exactly one accepted answer and that no hint text contains the answer.

---

## Adaptation rules

All thresholds live in `RULES` in `js/adaptiveEngine.js`. Players can also inspect them in-game under **Adaptive System → Inspect the rules**. They are starting points, not measures of intelligence.

| Signal | Response |
|---|---|
| 1 wrong answer | Feedback only. Wrong answers we recognise get a specific diagnosis. |
| 2 wrong answers | System offers a more explicit **Direction** clue. |
| 3 wrong answers | Clue **switches format** (visual / steps / table). |
| 2 hint requests before any attempt | Next hint is a **structured, step-by-step** clue. |
| Hint requested after ≥2 misses | Skips the gentle nudge and goes straight to Direction. |
| Same wrong answer re-submitted | Not counted again. |
| First try, no hints, ≤ 60 s | Counts as **fast & accurate**. In Room 01 this unlocks **Challenge Mode**. |
| ≥ 2 wrong or ≥ 2 hints | Counts as **needed support**. Next room stays manageable. |
| Needed support + next slot has an alternate | Next room teaches the same skill in a **different format** (e.g. numbers → visual blocks). |
| 2 fast solves in a row on Guided | **Promoted** to Challenge Mode. |
| Needed support on Challenge | **Eased** back to Guided. |
| On Challenge Mode | System clues arrive one attempt later (less explicit help). |
| **Skip room** (press twice to confirm) | The room counts as **skipped, never solved**. It's treated like needed support: Challenge eases to Guided, and the next room uses its alternate format if it has one. |

The answer is **never** revealed automatically. Hints stop at the guided-reasoning step. A player who skips sees the explanation, but the room's fragment of the hidden message stays corrupted. A run with any skipped room ends as **CASE CLOSED** instead of **CASE SOLVED**, and the report counts solved and skipped rooms separately.

### Branching

```
               ┌─ Challenge: 02 harder sequence → 03 cipher → 04 logic → 05 deep core lock ─┐
01 2,4,8,16,? ─┤                                                                             ├─ CASE SOLVED
               └─ Guided:   02 easy seq / visual → 03 odd-one-out / shape rule → 04 ordering → 05 core lock ─┘
```

Players can cross between branches at any room, based on how they played. The route map draws the path actually taken.

---

## Live demo walkthrough (about 3 minutes)

1. **Boot screen.** Click *Enter the box*. Optionally open *How it works* (four steps: observe, adapt the clue, choose the path, explain).
2. **Compare Two Minds → Watch scripted demo.** A banner labels it a **simulated demonstration** (scripted inputs and timings). The engine's responses are real. Captions narrate each step:
   - both players face `2, 4, 8, 16, ?`;
   - **Player B** answers 32 in 9 s → *Challenge Mode unlocked* → harder sequence → cipher;
   - **Player A** tries 24 (diagnosed), takes a nudge, misses again (system Direction clue), misses a third time (format switches to a to-scale bar chart), then solves → *Guided Discovery* with the **visual** version of the same skill → odd-one-out.
   - The board ends on **"Same starting point. Different minds. Different paths."**
3. **Back to live players.** Enter two names and let two judges play Room 01 in their own columns. Ask one to answer instantly and the other to guess wrong a few times. The side-by-side board updates live, and each column shows its own route map and reasoning.
4. **Solo run (optional).** Play to *CASE SOLVED*: see the decoded transmission, route, adaptation summary, then *View session report* (accuracy, hint use, difficulty progression, the categories that needed more guidance, every adaptation with its reason).

Controls: **Enter** submits. **Skip room** asks once for confirmation, then moves on. **Restart** asks for confirmation. **Stop / Replay demo** can be used at any time. Saved runs appear as **Resume** cards on the setup screen.

---

## Accessibility and robustness

- Keyboard: real `<button>`s and radio inputs, visible lime focus rings, a skip link, and native `<dialog>` (Esc closes).
- `aria-live` feedback and hint regions, plus labelled inputs and options.
- `prefers-reduced-motion` turns off animations and makes the demo pacing quicker.
- Responsive from 375 px phones (compare mode switches to A/B tabs) up to wide desktops.
- Guarded against double submission. An unanswered or invalid input never counts as solved. Moving to the next room works once per decision.
- Clocks pause when the tab is hidden or the player leaves the screen. The simulated demo uses its own virtual clock and is never saved.

## Known limitations

- Thresholds are hand-tuned for a demo and haven't been validated with real players.
- Puzzle answers live in client-side JS, so a curious player could read them. That's fine for a prototype; a real release would move validation to a server.
- One mystery with five rooms per run. More slots or alternates can be added in `PATHS` without changing the engine.

*Insights describe one session of play — never intelligence, personality or learning ability.*
