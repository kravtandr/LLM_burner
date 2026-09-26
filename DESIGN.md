# LLM Burner — interface design system

Updated 2026-09-26. This is the working design contract for future UI changes.

## Product and direction

LLM Burner is a measurement instrument for people running OpenAI-compatible endpoints. Its primary loop is configure → run → inspect → compare. Keep the dark theme, English interface, Simple/Advanced switch, remembered connections, and full-width Test settings → Performance → Requests order.

The direction is a quiet performance console. The distinctive element is the measured throughput trace and its numerical readout. Navigation, forms and chrome support it. Prefer operational clarity over a marketing-dashboard aesthetic.

## References inspected

The request's “SoothUI” is interpreted as **SmoothUI**; no matching SoothUI library was found. These are references, not installed component dependencies. Implementation is original React/CSS; no third-party component source or gallery artwork is copied.

| Reference | Observed pattern | Application here |
| --- | --- | --- |
| [SmoothUI / Animated Tabs](https://smoothui.dev/docs/components/animated-tabs) | Underline, pill and segmented states; keyboard navigation; reduced-motion support | Clear selected navigation and mode states, bounded transitions, visible focus |
| [Bencho](https://bencho.dev/) | Live controls, compact toolbars, selection lists, progress ticks, inline confirmation | Compact top navigation, tactile controls, scan-friendly request rows, progress with readable state |
| [Amicro](https://amicro.vercel.app/) | Restrained dark surfaces and individual button feedback such as copy, expand and settings | Neutral surface hierarchy, 120–180 ms press/hover feedback, copy confirmation, no ambient animation |
| [Inspora](https://www.inspora.design/) | Direct category navigation, strong alignment, varied visual emphasis and generous negative space | Clear grouping, purposeful empty space, a distinct primary metric rather than equal emphasis everywhere |

Browser captures used for review are in `artifacts/design-references/` (ignored by git). Gallery content can change. The mapping above records decisions, not claims that these sites define our exact tokens.

## Visual tokens

| Role | Value | Use |
| --- | --- | --- |
| Canvas | `#141516` | App background |
| Surface | `#1c1d1f` | Main working panels |
| Raised surface | `#252729` | Hover, menus, active controls |
| Primary text | `#f0f0ed` | Values and actionable labels |
| Secondary text | `#a5a7ab` | Supporting copy; never disabled-looking essential instructions |
| Data accent | `#a8c5e5` | Throughput line, focus and selection |

Borders: `#36383b`; success `#9dceb0`; errors `#f1a6a6`; warnings `#e1c38b`. Use color with text or a shape, never alone. Primary Run action is off-white against graphite. Stop remains a restrained red control. No gradient backgrounds or decorative glows.

Typography: locally served IBM Plex Sans 400/500/600. Its open forms and restrained engineering character suit a measuring tool. Body and input text 14px; helper text 12px; minimum nonessential metadata 11px. Page heading 32px/1.15 at weight 500; section headings 16px/1.4 at weight 500; measurements 40–48px with tabular numerals and weight 400. Monospace is reserved for JSON/code and endpoint strings. Avoid uppercase eyebrows, overly heavy labels and simulated terminal typography.

Spacing: 4, 8, 12, 16, 24, 32, 48px. Panel inset 24px desktop, 16px mobile. Content max-width 1328px. Radius: 6px small controls, 8px inputs/buttons, 12px working panels, 16px dialogs. Shadows only for floating menus/dialogs. Keep the three settings columns aligned; use space and subtle separators to define groups.

## Layout and hierarchy

```
Brand     Benchmark | Stress test | History                       Connection / Help

Benchmark your model                                      New test
Simple / Advanced                                  Configuration tools

Test settings                      Collapse / Expand
Endpoint + model       Context                  Load
Run test   Demo test                                  Request budget

Performance                                             Run status
Aggregate throughput        Request TPS       TTFT       p95
Throughput trace
Outcome counts and timing                         Run actions / Export

Requests                                      Click a request to inspect
Request    Status / phase       Tokens       TTFT       Duration       TPS
```

Use compact horizontal navigation for Benchmark, Stress test and History. Stress test shares the measurement workspace, replacing request count with load duration. Its progress is based on time, and draining requests have an explicit state. The page heading provides context once. Avoid repeated breadcrumbs, decorative local-workspace cards and redundant descriptive text.

Settings collapse after a successful start, with an explicit expand control outside the disabled fieldset. Inputs remain mounted to preserve values and focus semantics. Show the run name/model, count and progress. A cancelled or duration-limited run must not pretend to complete every planned request.

The performance area is a shared instrument surface, not a grid of floating statistic cards. Give aggregate throughput the strongest numerical hierarchy. Secondary labels remain muted and values stable in width. Numeric columns align right; status and request identifiers align left.

Requests are inspectable through explicit, keyboard-accessible buttons. Row hover helps scanning; no fake clickable cells. The inspector shows input/output side by side on desktop, stacked on narrow screens. Preserve provenance (assembled SSE), truncation, errors and legacy missing-payload messages. Copy actions visibly confirm success. Previous/next controls browse requests on the loaded table page without closing the inspector. JSON wraps safely; code panels have their own bounded scrolling.

## Interaction and accessibility

- Hover/press transitions: 120–180 ms, ease-out. Controls may move down 1px on press; data panels do not float or tilt.
- Menus/dialogs may enter with opacity and at most 4px translation over 160 ms. No looping animation, shimmer or animated metrics while benchmarking.
- Honor `prefers-reduced-motion` by removing transition/animation movement.
- Visible 2px focus outline, keyboard dropdown selection, Escape close and focus restoration.
- Controls at least 36px tall on desktop and 44px on touch layouts; fields 42px desktop, 44px mobile.
- No body-level horizontal scroll at 390px. Dense data tables scroll inside their container; controls never require sideways scrolling.
- Missing measurements are a dash, not zero. Demo runs stay clearly marked. Errors remain visible and actionable.
- Empty states describe the next action, not a slogan. Do not draw fake chart data.

## Implementation and review

`src/styles.css` owns base tokens, application layout and shared controls. Feature CSS owns advanced metrics, load curves and request details. Do not append layers of contradictory overrides to fix a component. Keep shared font and surface choices in the base system.

Preserve labels used by forms and accessibility tools. Do not alter benchmark timing, scheduler or storage behavior for a visual change. No animation runtime or third-party component framework is needed for this design.

Before calling a UI revision done: inspect screenshots at 1440px and 390px; cover empty, running/collapsed, completed, advanced, history and inspector states; verify dropdown clipping, focus, reduced motion and long payloads; run the existing browser workflow suite and production build. Source screenshots are inspiration, not the acceptance test: the app must work with its real data.
