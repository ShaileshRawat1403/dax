# Actual TUI captures

These are ANSI-frame captures of the running DAX TUI, rasterized at the stated
terminal cell dimensions. They are not the browser design studies. `before`
uses `a8043169adb35a7fcc9e73967bf31160581d2835`; `after` uses the
home-visual implementation. Both were launched against isolated test homes,
with the same project target and screen dimensions. The returning captures have
three active runs (one awaiting an approval) and a recent failed run.

| Terminal | First run, before | First run, after | Returning, before | Returning, after |
| --- | --- | --- | --- | --- |
| 50×16 | [PNG](before-first-50x16.png) | [PNG](after-first-50x16.png) | [PNG](before-returning-50x16.png) | [PNG](after-returning-50x16.png) |
| 64×18 | [PNG](before-first-64x18.png) | [PNG](after-first-64x18.png) | [PNG](before-returning-64x18.png) | [PNG](after-returning-64x18.png) |
| 80×24 | [PNG](before-first-80x24.png) | [PNG](after-first-80x24.png) | [PNG](before-returning-80x24.png) | [PNG](after-returning-80x24.png) |
| 96×36 | [PNG](before-first-96x36.png) | [PNG](after-first-96x36.png) | [PNG](before-returning-96x36.png) | [PNG](after-returning-96x36.png) |

The captures use the existing default theme. Terminal font and emoji fallback
may differ from an operator's terminal. The shared header, prompt, and footer
are rendered by the live application and were not altered for these images.
