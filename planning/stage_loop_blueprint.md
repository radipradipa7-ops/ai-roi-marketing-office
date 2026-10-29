# Stage Visual Loop: Operational Blueprint

**Project:** seamless, infinite LED stage loop for *Resonance of Indonesia*, rotating the Main Event logo, the *Kalantara* theme identity and tiered sponsor logos behind live performers.
**Status:** DRAFT v1 for the human team's review. Items marked **to verify** must be confirmed by a person before they become rules.
**Owner:** Manager (orchestrates). **Executes:** core team (6 roles) → Motion Graphics & Video Synthesis division (4 roles).

---

## 1. Organisation

```
                      YOU (Boss / human approvals)
                                │
                             MANAGER  ── orchestrates, gates, timeline
        ┌──────────┬──────────┬─┴────────┬──────────┬──────────┐
   RESEARCHER   ANALYST   COPYWRITER  HOOK WRITER  DESIGNER     │
   venue/tech   screen-   names &     kinetic      static       │
   specs        time      messaging   copy         masters      │
        └──────────┴──────────┴──────────┴──────────┘           │
                    HANDOFF PACKAGE (Gate G3) ──────────────────┘
                                │
          MOTION GRAPHICS & VIDEO SYNTHESIS DIVISION
   MOTION DIRECTOR → MOTION DESIGNER → RENDER ENGINEER → PLAYBACK QA
   (spec, timing)    (animation)       (render/encode)   (verify)
```

| Role | Office desk | Persona file | Writes to |
|---|---|---|---|
| Manager | Production & Ops | main chat session (this blueprint + `CLAUDE.md`) | `planning/` |
| Researcher | Insights Lab | `.claude/agents/researcher.md` | `research/` |
| Analyst | Insights Lab | `.claude/agents/analyst.md` | `reports/` |
| Copywriter | Creative Studio | `.claude/agents/copywriter.md` | `copy/` |
| Hook Writer | Creative Studio | `.claude/agents/hook-writer.md` | `hooks/` |
| Graphic Designer | Production & Ops ("Designer") | `.claude/agents/graphic-designer.md` | `design/stage_visual/` |
| Motion Director | Motion Graphics | `.claude/agents/motion-director.md` | `motion/` |
| Motion Designer | Motion Graphics | `.claude/agents/motion-designer.md` | `motion/animation/` |
| Render Engineer | Motion Graphics | `.claude/agents/render-engineer.md` | `motion/renders/` |
| Playback QA | Motion Graphics | `.claude/agents/playback-qa.md` | `motion/qa/` |

**File naming:** start every project file with `stage_` and include the role keyword so the office routes it to the right desk, e.g. `research/stage_venue_specs.md`, `reports/stage_screentime_rules.md`, `hooks/stage_kinetic_hooks.md`. Avoid other roles' keywords in a name (for example, don't put "visual" in a non-design file).

**Human approval gates** (the AI team never self-approves these):
- **G1** Venue specs confirmed by the production/AV vendor.
- **G2** Screen-time allocation confirmed against signed sponsor contracts.
- **G3** Static designs approved (brand owner, plus sponsors where contracts require it).
- **G4** Final render approved after an on-site LED test.

---

## 2. Tool requirements

| Need | Tool | Who | Notes |
|---|---|---|---|
| Orchestration and chat | AI Marketing Office chat (Claude Code), sub-agents via `Task` | Manager | Personas in `.claude/agents/` |
| Research | Web search/fetch; venue tech rider, LED processor spec sheet | Researcher | Never guess specs; mark **to verify** |
| Contract math | Spreadsheet/CSV; `motion/loop_spec.json` | Analyst | Allocation lives in the spec, not in prose |
| Static design | Canva (via the Canva connector, §8), Illustrator/Figma, or vector masters from the brand owner | Designer | Masters at the native LED canvas size, PNG with transparency, plus SVG/AI when available |
| Animation (advanced) | After Effects, Blender, TouchDesigner or Cavalry (human-operated) | Motion Designer | Particle and kinetic-type passes; exported as clips that slot into the timing |
| Reference render and encode | `ffmpeg` + `node motion/render_loop.js` (this repo) | Render Engineer | Frame-exact timing, cross-fades, seam check; ProRes 422 HQ / H.264 / HAP-Q |
| Verification | `ffprobe`, the render QA report, timing CSV, on-site LED test | Playback QA | |
| Playback (venue) | Media server: Resolume, disguise, Watchout, or a hardware player (**to verify**) | Venue/AV | Decides codec: HAP for Resolume, ProRes for disguise/Watchout, H.264 as a backup |

Install on the machine that renders (macOS): `brew install ffmpeg`. Node 18+ is already required by the office.

---

## 3. Collaborative pipeline

Each phase has an owner, inputs, outputs (file paths), a checklist and an exit gate. Every output file starts with a status line:
`Status: DRAFT | IN REVIEW | APPROVED by <human>`
It ends with an **Open questions** section. The Manager advances a phase only when its exit gate is met.

### Phase 0: Kickoff (Manager)
- **Out:** `planning/stage_loop_brief.md`: goals, deadline, show date, stakeholders, the list of required assets, and who owns approvals G1–G4.
- **Checklist:** confirm the event and theme names (exact spelling and casing); collect any existing brand guidelines; list sponsors and their tiers as currently known.
- **Exit:** brief written; open questions sent to you.

### Phase 1: Technical constraints (Researcher)
- **In:** brief; the venue's tech rider; the LED/AV vendor's contact.
- **Out:** `research/stage_venue_specs.md`, covering:
  - LED canvas resolution in pixels (the processor's input canvas, *not* the physical size), pixel pitch, and wall aspect.
  - Media server and accepted codecs/containers, plus frame rate (50 vs 60 Hz).
  - Colour range (full/limited), maximum brightness/nit policy, viewing distance.
  - Whether broadcast or video cameras film the stage (affects frame rate and flicker).
  - Delivery method and deadline; backup playback.
- **Rules:** cite a source for each value; anything not confirmed in writing is **to verify**.
- **Exit (G1):** a human confirms the values with the AV vendor. The Motion Director copies them into `motion/loop_spec.json` (`canvas`).

### Phase 2: Screen-time rules (Analyst)
- **In:** sponsor contracts or summaries (provided by you), the sponsor list and tiers.
- **Out:** `reports/stage_screentime_rules.md` plus the `allocation` and `sponsorTiers` blocks of `motion/loop_spec.json`.
  - Category shares (main / Kalantara / sponsors), tier weights, appearances per loop, minimum hold.
  - Per-sponsor guaranteed seconds per loop and per hour of show.
  - Conflicts (competing sponsors that must not be adjacent).
- **Method:** run `node motion/render_loop.js motion/loop_spec.json --plan` and attach the printed table. Every contract obligation must be met within ±1 frame per loop.
- **Rules:** never invent contract terms. If a contract states seconds per hour, convert: seconds per loop = seconds per hour × loop length ÷ 3600.
- **Exit (G2):** a human confirms against the signed contracts.

### Phase 3: Messaging and naming (Copywriter), parallel with Phase 4
- **Out:** `copy/stage_sponsor_naming_copy.md`:
  - Exact legal or brand display name per sponsor, tier labels (if shown at all), and the spelling and casing of "Resonance of Indonesia" and "Kalantara".
  - Any on-screen line (e.g. "Presented by", "Thank you to our partners").
  - Language policy (Bahasa Indonesia / English).
- **Rules:** sponsor names exactly as their contract or brand guide states; no slogans on sponsor slides unless provided by the sponsor.
- **Exit:** reviewed by the Manager; names used verbatim by the Designer and in `loop_spec.json`.

### Phase 4: Kinetic copy concepts (Hook Writer), parallel with Phase 3
- **Out:** `hooks/stage_kinetic_hooks.md`: 3–5 short kinetic-typography concepts (≤ 5 words each) for the Kalantara segment or the loop intro. For each: the word-by-word timing beat in frames, the motion description, and the legibility rationale.
- **Rules:** words must be readable from the back of the venue (≥ 1.5 s per word on screen); no text over sponsor logos; no competing claims.
- **Exit:** the Manager picks zero or more concepts. They are optional: the loop works without any copy.

### Phase 5: Static master design (Graphic Designer)
- **In:** G1 specs (canvas size, safe area), Copywriter names, brand guidelines, sponsor logo files (vector preferred).
- **Out (`design/stage_visual/`):**
  - `main_logo_master.png` and `kalantara_logo_master.png`, at the canvas size on a transparent background, logo inside the 80% safe area.
  - `sponsors/<tier>_<name>.png` (one per sponsor, same bounding box within a tier) or `sponsors/<tier>_board_<n>.png` (several logos sharing a board).
  - `stage_design_spec.md`: colours (hex), background treatment, minimum stroke width in LED pixels, which file maps to which spec entry.
- **Rules:** no stroke thinner than 2 LED pixels at the venue's pitch; dark backgrounds preferred (performer glare, LED heat); identical treatment within a tier; respect each sponsor's clear-space and colour rules (**to verify** with their brand guides). No upscaled bitmaps: the renderer warns if a master is too small.
- **Exit (G3):** a human approves the masters (and sponsors, where contracts require).

### Phase 6: Pre-handoff verification (Analyst, Copywriter, Researcher, coordinated by the Manager)
- **Out:** `planning/stage_handoff_checklist.md`, with a tick or a blocker per item:
  - [ ] Every sponsor in the contracts has exactly one entry in `loop_spec.json` with the correct tier (Analyst).
  - [ ] Display names match `copy/stage_sponsor_naming_copy.md` letter for letter (Copywriter).
  - [ ] Canvas size, fps, codec and colour range match `research/stage_venue_specs.md` (Researcher).
  - [ ] `--plan` table meets every contract minimum; no slide below the minimum hold (Analyst).
  - [ ] All files referenced in the spec exist; no placeholder remains (Manager).
- **Exit:** all ticked → handoff to Motion.

### Phase 7: Motion Graphics & Video Synthesis
1. **Motion brief and animatic** (Motion Director): `motion/stage_storyboard_v1.md` (order, transitions, ambient motion) and a placeholder animatic: `node motion/render_loop.js motion/loop_spec.json --placeholders --scale 0.25`.
2. **Animation passes** (Motion Designer), optional and human-operated in AE/Blender: particle transitions, Kalantara kinetic type, subtle ambient motion. Clips are exported as ProRes 4444 or PNG sequences at the canvas size and fps, following §5 R7/R9. A clip replaces a static file in the spec (`.mov` is accepted).
3. **Render and encode** (Render Engineer): `node motion/render_loop.js motion/loop_spec.json --formats prores,mp4,hap`. Outputs go to `motion/renders/`: masters, `<name>_timing.csv` and `<name>_qa.md`.
4. **QA** (Playback QA): automated report all PASS; manual review of every transition at full resolution; scrub the seam (last 2 s → first 2 s); sponsor timing vs the CSV; write `motion/qa/stage_playback_qa_checklist.md`.
5. **Sign-off** (Motion Director): fills in `motion/stage_delivery_note.md` (files, codecs, checksums, loop length, start-frame note).

### Phase 8: Delivery and on-site test (Manager, Playback QA, plus the human AV team)
- Deliver the primary codec, a backup codec, and a still-image fallback (`main_logo_master.png` at canvas size) on two separate drives.
- On site: play at least 3 full loops on the actual wall; check the seam, colour and brightness, moiré at the pitch, and any camera flicker; confirm sponsor visibility from the audience's viewing positions.
- **Exit (G4):** a human signs off. Any later sponsor change means re-run Phases 2 → 7.4 and redeliver.

---

## 4. Handoff package (core team → Motion)

```
motion/loop_spec.json                 ← single source of truth (canvas, timing, allocation, files)
design/stage_visual/main_logo_master.png
design/stage_visual/kalantara_logo_master.png
design/stage_visual/sponsors/*.png
design/stage_visual/stage_design_spec.md
research/stage_venue_specs.md         (G1 confirmed)
reports/stage_screentime_rules.md     (G2 confirmed)
copy/stage_sponsor_naming_copy.md
hooks/stage_kinetic_hooks.md          (optional)
planning/stage_handoff_checklist.md   (all ticked)
```

---

## 5. Looping and timing rules (strict)

Starting values for the rules below are in `motion/loop_spec.example.json`. Every number there is a placeholder until G1/G2.

- **R1. Frame-exact.** All timing is in whole frames at the delivery fps. Default 50 fps (Indonesia's 50 Hz mains and PAL video: fewer flicker and banding artefacts on cameras); 60 fps only if the media server requires it (**to verify** in Phase 1).
- **R2. Loop length.** 60–180 s, default 120 s, a whole number of frames. No audio track.
- **R3. Rotation grammar.** One cycle = `MAIN → SPONSOR BLOCK → KALANTARA → SPONSOR BLOCK`, repeated `cycles` times per loop (default 2). Main always opens the loop. The highest tier sits first in every block, directly after Main and Kalantara (premium adjacency).
- **R4. Screen-time accounting.** A slide owns the screen from the midpoint of its incoming transition to the midpoint of its outgoing one. Owned times add up to the loop length exactly. Each category's total must be within ±1 frame of its target; the renderer prints and checks this.
- **R5. Allocation.**
  - Main gets `allocation.main × loop` and Kalantara `allocation.kalantara × loop`, each split evenly over its appearances.
  - Sponsors share `allocation.sponsors × loop`: each slide gets `S × w / Σw`, where `w` is its tier weight, split over its appearances.
  - Default appearances: tier 1 in every sponsor block, tier 2 in every other block, lower tiers once per loop. The Analyst may override `appearances` per tier.
  - Boards that show several sponsors share one slide's time. The Analyst decides whether a contract allows boards.
- **R6. Minimum hold.** Every slide owns at least `minHoldSeconds` (default 4 s) so logos are readable at a glance from the back. The renderer refuses plans that break this. Fix it by lengthening the loop, reducing cycles, or grouping lower tiers onto boards.
- **R7. Transitions.**
  - Length 0.8–1.5 s (default 1.0 s), identical within a category; never a hard cut.
  - Defaults: into Main = `fadeblack` (a dip that resets attention), into Kalantara = `dissolve` (grain/particle feel), into sponsors = `fade`.
  - Custom particle transitions from AE/Blender must last exactly `transition.seconds` and start and end on frames identical to the static masters, so the timing math still holds.
- **R8. Seam.** The file starts `d` frames into the Main hold (`d` = transition length in frames). The frame after the last one is identical to the first one. QA requires the renderer's seam check to report PSNR ∞, and frame-to-frame change across the seam to be no larger than inside the neighbouring transition.
- **R9. Motion inside holds.** Ambient motion (slow push-in ≤ 3%, drifting particles, shimmer) must start and end at rest within the slide, or be periodic with a period that divides the slide length. Logos stay static and fully legible for ≥ 80% of their owned time. Sponsor logos get uniform scale at most, unless the sponsor's guide allows more (**to verify**).
- **R10. Photosensitivity and LED comfort.** No more than 3 flashes per second; no full-screen luminance swing above ~20% of peak within 0.5 s; no saturated red flashes (WCAG 2.3.1 and ITU-R BT.1702 guidance). No full-white fields (performer glare, LED heat and power); dark grounds by default.
- **R11. Safe area and legibility.** Logos fit inside the central 80% (`canvas.safeArea`). Strokes are at least 2 LED pixels. Check moiré and banding on the real pitch during the G4 test.
- **R12. Sponsor fairness.** Within a tier: same bounding box, transition and owned time. Order rotates across blocks. Competitors are never adjacent (the Analyst lists conflicts; the Motion Director orders the blocks accordingly).
- **R13. Change control.** `loop_spec.json` is versioned in git. Any change to the sponsor list, allocation or canvas means re-plan, re-render, re-QA, and a new delivery-note entry.

**Worked example (placeholder numbers):** 120 s at 50 fps, 2 cycles, 35/25/40 split, tiers weighted 3/2/1. Main owns 42.00 s (2 × 21 s), Kalantara 30.00 s (2 × 15 s), sponsors 48.00 s: Platinum A 18 s (4 × 4.5 s), each Gold 12 s (2 × 6 s), the Silver board 6 s. Total 6000 frames, with every category on target (0-frame error). Reproduce it with `node motion/render_loop.js motion/loop_spec.example.json --plan`.

---

## 6. Verification protocol

**Automated** (every render; written to `motion/renders/<name>_qa.md`):
- the seam is identical;
- each output has the canvas size, the fps and exactly P frames;
- owned times add up to P;
- warnings for upscaled masters.

**Manual** (Playback QA, `motion/qa/stage_playback_qa_checklist.md`):
1. Watch three loops end to end at full resolution; note any jump at the seam.
2. Step frame by frame through every transition; confirm no hard cut and no flash.
3. Compare each sponsor's on-screen time with `<name>_timing.csv` (± 1 frame).
4. Check spelling of every name against the Copywriter file.
5. Check the safe area on a 1:1 pixel view; check stroke widths.
6. Play the delivery file on the target media server, or the same software version, with looping enabled; confirm no black frame at the wrap.
7. On site (G4): view from the back row and from the side; watch the camera feed for flicker or banding; confirm brightness with the AV vendor.

---

## 7. Collaboration protocol

- **Single source of truth:** numbers live in `motion/loop_spec.json`; reasoning lives in the phase documents. When they disagree, the spec wins and the document is fixed.
- **Status lines and open questions** at the top and bottom of every phase file (§3). An agent that is blocked writes its blocker under Open questions and stops; it never fills gaps by guessing.
- **Handoffs:** the producing agent ends its file with `Handoff → <role>: <what is ready, what to check>`. The Manager reads it and starts the next phase.
- **Reviews:** one reviewer per deliverable (Analyst reviews numbers, Copywriter reviews names, Researcher reviews specs, Motion Director reviews motion). Review notes are appended to the file under `## Review`.
- **Escalation to you:** missing contracts, unconfirmed specs, missing logo files, sponsor conflicts, or a plan that can't meet a contract within the loop.
- **Running it from the office chat**, for example:
  - "Act as Manager. Start Phase 0 and Phase 1 of planning/stage_loop_blueprint.md."
  - "Phase 2: here are the sponsor tiers and contract seconds: …"
  - "Motion Director: build the placeholder animatic from motion/loop_spec.json."
  - "Render Engineer: render the final masters with prores,hap and report QA."

---

## 8. Canva connection (Graphic Designer)

**What's possible:** Canva offers an official connector ("Search, create, autofill, and export Canva designs"). Through it, Claude can search your designs, create and edit them, autofill brand templates, and export them.
- **Office chat** (`claude -p`): `office-config.json` already allows the connector's tools (`mcp__canva`). Every Canva action is logged at the Designer's desk and flagged in the Manager's report as an external action, because it changes your Canva account.
- **CLAUDE.md** allows Canva designs only as private drafts in your own account: never shared or published from here.

**Setup (once, on your Mac):**
1. In the project folder: `claude mcp add --transport http canva https://mcp.canva.com/mcp`
2. Run `claude`, type `/mcp`, choose **canva**, and log in to Canva in the browser window that opens. Then `/exit`.
3. Restart the office (`npm start`). Chat runs can now use Canva.

**Workflow:**
1. The Designer creates a custom-size design at the exact LED canvas pixels from G1 (one page per slide) and applies your brand kit.
2. It exports PNG at full size.
3. **You download the PNGs into `design/stage_visual/`**. Saving files from Canva into the repo is a manual step, because the chat may only run the render script.
4. The Designer updates `stage_design_spec.md` and the spec's file paths.

**Limits (to verify):** design resizing needs Canva Pro or above; brand templates, autofill and brand kits need Enterprise. Export options depend on your plan. Canva is best for layout and typography boards. Final logo masters should come from vector originals supplied by the brand owners and sponsors.

---

## 9. Risks and fallbacks

| Risk | Mitigation |
|---|---|
| Venue specs change late | Spec-driven render; re-render takes minutes. Keep the canvas in one place (`loop_spec.json`) |
| Sponsor added or removed close to the show | Change control (R13); placeholder-free check in Phase 6 |
| Media server rejects the codec | Deliver ProRes and HAP-Q plus H.264; test on the target software before show day |
| Seam glitch on the venue player | Automated seam QA; test looping on the actual player; still-image fallback |
| Photosensitivity complaint | R10 enforced; transitions ≥ 0.8 s; no flashes |
| Logo misuse (stretching, wrong colours) | Masters from brand owners; G3 approval; renderer only scales uniformly |

---

## 10. Open questions for the human team
1. LED canvas resolution, pixel pitch, media server model/software, frame rate, colour range. (Researcher → AV vendor)
2. Sponsor list, tiers and contract screen-time terms; are shared boards allowed for lower tiers? (Analyst → sponsorship lead)
3. Exact display spelling of "Resonance of Indonesia" and "Kalantara"; brand guidelines and vector files. (Copywriter/Designer → brand owner)
4. Will cameras or a livestream film the stage? (Researcher)
5. Delivery deadline and on-site test slot. (Manager)
