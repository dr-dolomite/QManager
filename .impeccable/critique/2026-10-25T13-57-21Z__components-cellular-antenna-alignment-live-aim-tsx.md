---
target: Live Aim console
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:D:\\Projects\\QM PROJECT\\QManager\\components\\cellular\\antenna-alignment\\live-aim.tsx"
target_fingerprint: "sha256:158b048c383f766b65b0357e8db1073099ded0a069399f33139f0f59fb17883e"
target_path: "D:\\Projects\\QM PROJECT\\QManager\\components\\cellular\\antenna-alignment\\live-aim.tsx"
timestamp: 2026-10-25T13-57-21Z
slug: components-cellular-antenna-alignment-live-aim-tsx
---
# Critique: Live Aim console (components/cellular/antenna-alignment/live-aim.tsx)

Method: dual-agent (A: design review, B: detector + browser evidence)

## Design Health Score: 25/40 (Acceptable)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | State chips distinct; phone pill shows at rest |
| 2 | Match System / Real World | 3 | No scale cue on the score |
| 3 | User Control and Freedom | 2 | No session-peak reset |
| 4 | Consistency and Standards | 3 | Score 32px vs Position rows 28px; 2-line description |
| 5 | Error Prevention | 3 | partial chip, muted stale state |
| 6 | Recognition Rather Than Recall | 2 | Serving RSRP vs PRX RSRP leg told apart by eyebrow + far footer |
| 7 | Flexibility and Efficiency | 2 | No peak reset / Record shortcut |
| 8 | Aesthetic and Minimalist Design | 1 | Two headline numerals, two meters, two peaks, RSRP x3 |
| 9 | Error Recovery | 3 | Chips say why a figure froze |
| 10 | Help and Documentation | 3 | Cadence + chain note on the surface, not behind the hint |

## Design Specificity
Behaviour authored for aiming (peak-hold, 1 Hz lead vs 2 s score, weights, feed states, shared scorer); presentation drifted to "big number, small label" x2 in alarm red. Detector: 0 findings in the three files; page overlay: skipped-heading h1->h3 (shared CardTitle, page-wide).

## Priority Issues
- [P1] Two ramp-red headline numerals compete (~13 emphasised marks, 9 ramp-ink). Fix: lead 52->40px; score becomes a 64px "Now" row with Position-row anatomy (28px); trace neutral ink (inkClass currently paints whole history by newest sample). distill, quieter.
- [P1] Steering cue (to-peak) is 12px grey caption. Fix: 16px/600 on numeral row right edge with 12px peak under; filled info "At peak" badge. layout.
- [P1 bug] Phone pinned pill visible at scrollY=0: sentinel below viewport counts as "scrolled away" (antenna-alignment.tsx observer). Fix: require boundingClientRect.top < rootBounds.top. adapt.
- [P2] Console 837px at 1440x900, legs below fold; 192px mostly-empty trace. Fix: ceiling ~112px, slimmer console, rebalance 1440 work column (2x2 Chains). layout, adapt.
- [P2] Redundant copy: RSRP x3, two Peak captions, inline cadence, 2-line description, chain sentence far from legs. clarify, distill.

## Persona Red Flags
- Field tech: score+legs below fold on 375x812; pill lacks to-peak; all-red at cell edge; no at-peak moment.
- Alex: RSRP x3; no peak reset.
- Sam: all live figures aria-live off, no on-demand announce; delta sr text lacks amount.

## Minor Observations
Divider + pills double separator; tiny delta beside 32px numeral; bold peak values; longest caption is the timestamp+cadence.

## Questions
Score on screen during sweep or only at Record? To-peak as hero? Progress cue other than level colour at cell edge?
