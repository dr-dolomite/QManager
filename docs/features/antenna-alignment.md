# Antenna Alignment and Antenna Statistics

The two antenna pages under `/cellular/`, re-authored in the RM520N canon by ledger rows U4.14 and U4.15 (2026-10-19, source `a05c4e92`). Neither has a CGI of its own: both read `signal_per_antenna` from `useModemStatus()` (`/tmp/qmanager_status.json`). Alignment additionally holds a live-signal lease for a 5 Hz serving-cell RSRP lead (see [Live lead](#live-lead-qmi-phase-2)). The fork's long-form notes are `docs/reference/antenna-alignment.md` and `docs/reference/antenna-statistics.md` at `a05c4e92` (`git show a05c4e92:<path>`); this file records the contract and the QManager deviations.

The pages are a transpose of each other. **Statistics** is technology-major (an LTE card and an NR5G card, four ports each) and answers "which chain is broken". **Alignment** is port-major and answers "which way should I point this thing".

## Files

| Thing | Where |
| ----- | ----- |
| Statistics shell + state routing | `components/cellular/antenna-statistics/antenna-statistics.tsx` |
| Per-radio card, port block, metric row | `components/cellular/antenna-statistics/tech-card.tsx` |
| Context strip (Active MIMO / Serving mode / Chains reporting), geometry from `components/cellular/tile-shape.ts` | `components/cellular/antenna-statistics/context-tiles.tsx` |
| Alignment shell (console + Positions + Receive Chains) | `components/cellular/antenna-alignment/antenna-alignment.tsx` |
| Live Aim console and the pinned phone readout | `components/cellular/antenna-alignment/live-aim.tsx` |
| Live lead derivation (peak, trace points) and its 30 s trace | `components/cellular/antenna-alignment/use-live-lead.ts`, `live-sparkline.tsx` |
| Positions recorder card | `components/cellular/antenna-alignment/recorder-card.tsx` |
| Recorder state machine + `localStorage` | `components/cellular/antenna-alignment/use-position-recorder.ts` |
| Receive Chains strip | `components/cellular/antenna-alignment/port-strip.tsx` |
| Geometry and tone contract for the alignment family | `components/cellular/antenna-alignment/shapes.ts` |
| Scoring layer (`scoreSnapshot`, `findBestSlot`, ranking scale) | `components/cellular/antenna-alignment/utils.ts` |
| Skeletons + condition screens (each page) | `states.tsx` in each folder, on `components/cellular/condition-screen.tsx` |
| Quality glyph / chip / meter / ink | `components/cellular/signal-quality-display.ts` (no private copies anywhere in the family) |
| Sentinel boundary | `types/modem-status.ts`: `SignalMetric`, `SIGNAL_SENTINELS`, `normalizeSignalValue`, `isPortReporting`, `hasAntennaData` |
| Port metadata | `ANTENNA_PORTS` in `types/modem-status.ts` (the one port table; never duplicate it) |
| i18n | `antenna_statistics.*` (38 keys) and `antenna_alignment.*` (81 keys) in `public/locales/*/cellular.json`; metric labels reuse `radio_info.bands.metric.*` |

## The sentinel boundary (shared by both pages)

The modem says "this port measured nothing" three ways and the poller only translates one (`-32768` to `null`). `normalizeSignalValue(value, metric)` returns `null` for:

- RSRP `-140` and `-32768`
- RSRQ `-32768` only (a real `-19` dB RSRQ is reachable, so `-20` is not a sentinel there)
- SINR `-20` and `-32768`

The table is for AT readings (`AT+QSINR` reports `-20` on an idle chain). The dashboard's live QMI SINR overlay (`liveLteDb` in `types/live-signal.ts`) skips the SINR row: the broker already drops QMI's own invalid value and gates the range, so a live `-20.0` dB is a real reading.

Confirmed on the RM551E on 2026-10-19: `/tmp/qmanager_signal_history.json` shows `lte_rsrp` `-140` in the same sample and port index as `null` RSRQ and SINR, the same pattern the fork measured on the RM520N. Every per-antenna value on both pages goes through this function; pass the real metric at each call site. A null reading renders as "Not reported" / "Not reporting" with `MetricBar value={null}`, never as an empty bar labelled `-140 dBm`.

## Antenna-type toggle contract (kept from the old page)

- Two antenna types in the Positions card, `directional` (default slot labels `0°`, `45°`, `90°`) and `omni` (`Position A`, `B`, `C`, resolved through i18n while untouched). Labels are editable per slot and freeze at capture time.
- Three slots; each recording averages three samples, gated on the modem's own `timestamp` so an unchanged snapshot is never counted twice.
- Composite score is 60% RSRP + 40% SINR (`SCORE_WEIGHTS`) on the full 3GPP ranking scale, not the display scale. A missing leg reweights instead of scoring zero. `scoreSnapshot` is a pure function of the stored snapshot; do not give it a live-state argument.
- The recommendation appears once two or more slots are recorded.
- The recorder is client-side only: `localStorage` key `qmanager:antenna-alignment:v1` (`{version, antennaType, slots}`), no backend (persistence is new with U4.15; the old page held recordings in memory only, so there is nothing to migrate). `isDefaultLabel` is optional, and bumping `version` would discard every stored recording.

## Live lead (QMI Phase 2)

The console's composite, SINR leg and Receive Chains stay on the per-port 2 s snapshot. Above them sits a **live lead**: the serving cell's RSRP at 0.1 dB, fed by `useLiveSignal({tier:"aim"})` (1 s; 5 Hz was dropped, settled at 1 Hz on 2026-10-25, see [`live-signal.md`](live-signal.md#cadence-decision-2026-10-23)). `useLiveLead()` runs once in `antenna-alignment.tsx` and hands the same object to the console and the condensed pill, so the two can never disagree about the session peak.

- **What it is.** The serving cell's RSRP as the modem reports it across **all receive chains** (the LTE anchor in NSA). It is **not** port 1 / Main (PRX); labels and copy never imply it is, and the two readings sit side by side.
- **`null` is today's console.** `useLiveLead()` returns `null` when the feed is `unavailable`, no sample has arrived, or no sample in the ring has a serving RSRP (connecting; 5G SA, where the live file has no LTE serving cell). `live-aim.tsx` then renders exactly as it did before the live channel existed. Never add a placeholder lead.
- **Chip per state, each with its own glyph** (`LIVE_STATE_CHIP`): `live` is the one fact, a filled `info` Badge (`graphic_eq`); `stale` is a `warning` Badge (`history`); `paused` is `muted` (`visibility_off`); `connecting` is `muted` (`progress_activity`). In every state but `live` the numeral and trace are dimmed (never blanked) beside the chip, and the block carries `aria-live="off"` because the page shell is already a polite live region.
- **Peak** is the best serving RSRP seen on the current cell (PCI/EARFCN key). It is adjusted during render from the sample sequence (no effect) and a handover resets it: a peak on another cell is not a position this antenna can return to. `toPeak` is `rsrp - peak`, zero or negative.
- **Console anatomy (2026-10-25 redesign).** One numeral leads: the live RSRP at 40px (`CONSOLE.SCORE`), with the steering cue on the same row's right edge (`toPeak` at 16px/600 over "Peak −113.1 dBm" at 12px). At the peak (`toPeak > -0.05`) the cue becomes a filled `info` Badge "At peak" with `my_location`, per Fact-Is-Info. The composite score is no longer a second headline: it is a 64px **"Now" row** in the Position row's anatomy (label sized to its word, `SLOT.SCORE` 28px, a flex-1 bar with the session-best tick, delta in a fixed 32px slot so the bar never jumps; a 5.5rem label slot plus a 44px delta slot left the phone bar ~43px). Sections are told apart by small-caps labels ("Aim score" with a `HintIcon` holding the 2 s cadence and scale, "From Main / PRX" over the legs), never a divider. The snapshot clock time is no longer printed; a stalled feed is the page's stale `Banner`.
- **Trace.** A 30 s plain-SVG polyline (`LiveSparkline`, not recharts: no axes, tooltip or animation, one `points` string per redraw). The x axis is the modem's own sample clock anchored on the newest sample; a gap over 2.5 s breaks the line instead of bridging it; the y axis never zooms below a 6 dB span, so a 0.4 dB wobble is not drawn edge to edge. It is drawn in neutral ink (`LIVE.SPARK_INK`): painting all 30 s in the newest sample's ramp colour gave history a verdict it never had.
- **Condensed pill** (the pinned phone readout) shows the live RSRP when a lead exists and pins on it, since the lead leads the card, with the distance to peak on its right edge (the `my_location` glyph at the peak). It carries no key label: "dBm" already tells it apart from a 0-100 Position row. It shows only once the sentinel under the console has left **above** the viewport (`boundingClientRect.top < rootBounds.top`); "not intersecting" alone also matched a sentinel still below the fold, which pinned the pill over the page title at rest on a phone.
- **Unchanged:** `scoreSnapshot` and the Positions recorder (3 samples gated on the 2 s snapshot `timestamp`) never read live data; the composite stays per-port. Copy lives under `antenna_alignment.aim.live.*` in all five catalogs.

## QManager deviations from the fork

- **Four quality stops, not five.** The fork scores a fifth `bad` level (RSRP below `-120`) and adds `floor` / `range` to `SignalThresholds`. QManager's `getSignalQuality()` still has four stops, and widening the shared union touches every authenticated signal surface, so the antenna files land as-is and simply never receive `bad`. The `antenna_statistics.quality.bad` / `antenna_alignment.quality.bad` keys are kept, ready for when the five-stop model lands (see the port note in `signal-quality-display.ts`).
- **No `max-w-*` page cap.** The only `max-w` left is the header description column (`max-w-[41rem]`, sanctioned by the Full-Width Page Rule) and the empty-state paragraph in `tech-card.tsx`.
- The old `antennas.*` i18n subtree, `alignment-meter.tsx` and `antenna-card.tsx` are retired.

## Gotchas

- `CONSOLE_SPLIT` must not get `items-start`: the sticky console needs its column to stretch, or it never pins.
- Receive Chains lives in the work column under Positions (moved back from a full-width row on 2026-10-25, once the live lead made the console ~620px tall). Each column has one slack absorber: the live trace on the console (`LIVE.SPARK_SLOT`, 48 to 208px). The console always matches the work column's height, so its height is fixed in the work column, never by lowering the trace cap: a 112px cap only moved 1440's slack into an empty band above the score and the Chains card in the work column (`CARD_FILL`). Never give Positions `h-full` again: in a two-card column it claims the whole column. Its grid steps on `@container/card` (`PORT.CONTAINER`), not on `@container/main`: one column on a phone card (name and RX pill share a line, 92px tiles), 2-up from `@md/card` (name stacked, 118px), 4-up from `@xl/card` (576px; it was `@3xl/card`, which left the 1440 card at 2x2 and the console at 837px with a ~240px hole; one row brings both columns to ~709px). The verdict chip needs `shrink` beside `min-w-0`: `Badge` is `shrink-0`, so without it the label never truncated in a 137px tile. The `PORT.HEIGHT_*` pins and `SKELETON_SHAPE.PORT_BLOCK` move together with those steps.
- Receive Chains draws LTE / NR rows from the surface-level radio mode, never from whether a port currently reports, so a dropping chain shows "Not reported" rather than vanishing.
- Port blocks on Statistics stay mounted at a pinned height and say "Not reporting"; chains drop in and out several times an hour and a collapsing block would make the card jump.
- Card order on Statistics comes from `network.type` (`5G-SA` puts NR first), not from which radio has readings, because per-antenna presence flaps.
- Template-literal i18n keys (`quality.<q>`, `card.<prefix>.*`, `empty.<prefix>.*`, `context.mode.<mode>`, `mode.<radio>`) are invisible to grep; do not delete them for lack of a call site.
