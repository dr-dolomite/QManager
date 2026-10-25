---
target: install state of Tailscale (hierarchy, direction, layout)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:D:\\Projects\\QM PROJECT\\QManager\\components\\monitoring\\tailscale\\install-card.tsx"
target_fingerprint: "sha256:f72e26a728fee1d4a631f330e07f592081d7ee145b7fccde0a819de55f9ea490"
target_path: "D:\\Projects\\QM PROJECT\\QManager\\components\\monitoring\\tailscale\\install-card.tsx"
timestamp: 2026-10-25T16-19-26Z
slug: components-monitoring-tailscale-install-card-tsx
---
# Critique: Tailscale not-installed state

Method: dual-agent (A: design review, B: detector + browser evidence). Score 25/40.

Heuristics: 1=3, 2=3, 3=2, 4=2, 5=2, 6=2, 7=3, 8=2, 9=3, 10=3.
Detector: exit 0, no findings. Page not rendered live (login redirect).

Verdict: partly authored. Generic SaaS empty state (disc, bold "not installed", paragraph, centred CTA) with a build picker wedged in.

## Priority issues
- [P1] Card-in-card half-measure inverts hierarchy: ConditionBlock (rounded-hero) inside HERO_SHELL (rounded-hero). Fix: remove it, retitle "Install Tailscale", settings grammar (Build row key-left / SegmentedField right), commit on bottom edge. layout, distill.
- [P1] Data cost welded to status, not to decision/commit. Fix: footer-left warning beside Install, ~60 chars, show download size / free flash. clarify.
- [P2] Build choice hides differentiator (half the flash, uninstall to switch) in tooltip and shows mechanism. Fix: parallel consequence lines, keep switch clause visible. clarify.
- [P2] Loading/running states contradict surface: installed skeleton on first paint, "not installed" status during install, log below fold on phone. harden.
- [P2] Check again competes as peer. Fix: icon-sm refresh in header. quieter.

## Personas
Alex: no size/version/free flash, no manual route. Jordan: what-it-is sentence is quietest, no sign-in warning. Casey: Install ~760px, 34px segments. Field tech: no size, cancel, or link-drop guidance.

## Minor
HERO_SHELL should be CARD_SHELL; BUILD eyebrow belongs left; success notice redundant with toast; subtitle over-promises; description over copy budget; use muted Not installed badge in header.
