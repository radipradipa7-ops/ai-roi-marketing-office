# Resonance of Indonesia (ROI): AI Marketing Office

This project is an **ideation extension** for the Resonance of Indonesia Instagram marketing team.
Everything produced here is a draft that the real-world team reviews, edits, and publishes.

## Ground rules
- Ideation only. Never post, publish, schedule, email, deploy, or push anything to an external service.
  Sales outputs (pitches, outreach, proposals) are drafts too: never contact prospects or clients.
  Exception: the Canva connector may create and edit **private drafts in the user's own Canva account**.
  Never share, publish or send a Canva design from here.
- Write outputs as Markdown (or CSV for data) in the folders below, so the office routes them to the right desk.
- Use clear, descriptive file names that contain the role keyword, e.g. `hooks/viral_hooks_week3.md`.
- Don't overwrite existing team files unless asked; create a new versioned file instead (`_v2`).
- Mark anything you are unsure about (facts, figures, trends) as **to verify**; never invent metrics.
- Don't edit `office/`, `.claude/`, or `office-config.json` unless the user asks for changes to the office itself.

## The team (desks in the 3D office)
| Role | Does | Put files in | Name keywords |
|---|---|---|---|
| Researcher | Trends, market opportunities, competitor scans | `research/`, `trends/` | trend, market, competitor |
| Hook Writer | Viral hooks, creative angles, openers | `hooks/` | hook, angle, viral |
| Copywriter | Reel scripts, captions, narrative storytelling | `scripts/`, `captions/` | script, caption, story |
| Designer | Visual briefs, thumbnails, carousel layouts, moodboards | `design/`, `assets/` | thumbnail, visual, carousel |
| Analyst | Performance and audience-retention analysis | `metrics/`, `reports/` | metrics, retention, kpi |
| Manager | Content calendar, planning, workflow | `calendar/`, `planning/` | calendar, plan, brief |
| Sales Manager | Sales targets and KPIs, sales analytics, team coaching | `sales/` | target, forecast, playbook |
| Account Executive | Prospect research, pitches, demos, proposals, negotiation notes | `sales/`, `proposals/`, `pitches/` | pitch, proposal, deal, outreach |
| Customer Success | Onboarding, support, retention, upsell and cross-sell plans | `sales/`, `clients/` | onboarding, retention, upsell |
| Motion Director | Loop spec, storyboard, timing rules, motion sign-off | `motion/` | loop_spec, storyboard, timing |
| Motion Designer | Transitions, particles, kinetic type, ambient motion | `motion/animation/` | animation, transition, particle |
| Render Engineer | Renders and encodes loops (ProRes, HAP, H.264) | `motion/renders/` | render, encode, prores |
| Playback QA | Seam, timing, spelling, LED playback verification | `motion/qa/` | qa, seam, playback |

Sub-agent personas for these roles live in `.claude/agents/` (researcher, analyst, copywriter, hook-writer,
graphic-designer, motion-director, motion-designer, render-engineer, playback-qa).

## Stage visual project (LED loop)
When asked to work on the stage loop, act as the **Manager**: follow `planning/stage_loop_blueprint.md` phase by phase,
delegate each phase to its sub-agent (Task tool), check its exit gate, and stop at human gates G1–G4 with a clear list of
what you need. Numbers live in `motion/loop_spec.json`; render with `node motion/render_loop.js` (see the blueprint).
Run it exactly as `node motion/render_loop.js …` from the project root: no `cd`, `&&`, `;` or absolute paths
(other forms are blocked). Check the toolchain with `node motion/render_loop.js --doctor` before saying ffmpeg is missing.
Name project files with a `stage_` prefix plus the role keyword (e.g. `reports/stage_screentime_rules.md`).

## ROI Instagram updates (tracked hand-off area)
Changes here are highlighted in the office's Activity feed and the Manager's reports, because they go to the human team:
- `instagram/drafts/`: IG-ready drafts (captions, carousel copy, reel scripts) for hand-off
- `instagram/templates/`: reusable content templates
- `instagram/metrics/` or `metrics/`: platform metrics exports and notes
