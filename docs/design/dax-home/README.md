# DAX home: visual execution brief

Design proposal for Sol. Baseline: `7ccfc8a4cdd93ff054cabe2c43197438b88e8995`.
Open `mockups.html` in a browser. It contains eight character-grid studies: first-run and returning states at 50×16, 64×18, 80×24, and 96×36. These are design studies, not screenshots of a running TUI. Shared header, prompt, and footer are schematic reference areas; their actual rendering remains unchanged.

## Direction

A compact custom pixel DAX wordmark, a left-aligned content column, clear typographic hierarchy, and short section rules. A quiet instrument-like surface: identity comes from the lettering, alignment, and restrained density rather than decoration. The wordmark is static and occupies three terminal rows on roomy screens, one ordinary-text row on compact screens. No splash or added delay.

The preview's teal, violet, and monochrome options demonstrate theme adaptation, not new product themes. Map the wordmark and brand accent to existing `theme.primary`; body text to `theme.text`; supporting text to `theme.textMuted`; dividers to `theme.borderSubtle`. Preserve status/warning/error colors, including approval counts. Do not hardcode preview colors in production.

## Execution scope

- Home-local `BrandLetters`, mascot presentation, greeting, workspace-card styling, section separators, and Quick Start chip styling in `home.tsx`.
- Retain existing dynamic greeting and copy. Keep the current tagline unchanged in this slice; it is omitted from the schematic compact reference areas only where noted by sizing.
- Replace the home-body cycling letters and mascot with the supplied wordmark. Shared header animations remain outside scope; do not claim the entire application is static.
- Use consistent left edges and single-line, low-contrast separators. Remove the enclosing decorative session card border; retain its contents and hit areas. Keep Quick Start click targets at least their existing size.
- Keep PROJECT / BRANCH / MODEL labels and actual values. Never substitute a logo or decorative line for warning, failure, approval, or recovery information.
- Keep the Prompt component, props/ref/hint, focus behavior, shortcuts, handlers, navigation, guide prompt, ordering, data selection, row limits, and visibility conditions unchanged.
- ACTIVE and RECENT remain distinct, with current step, status, pending approvals, age, and failure explanation retained. Example rows in the mockup are fixtures, not new copy/data sources.
- No shared header/footer/theme/provider/governance changes. No dependencies, asset loading, animation timers, or startup effects.

## Responsive contract

Preserve the live `home.tsx` conditions, not the different currently unused visibility fields of `deriveHomeLayout`:

| Size | Greeting | Workspace | Quick Start | Guide / runs |
| --- | --- | --- | --- | --- |
| 50×16 | hidden | hidden | hidden | hidden |
| 64×18 | shown | hidden | hidden | hidden |
| 80×24 | shown | hidden | shown | hidden |
| 96×36 | shown | shown | shown | shown when applicable |

The live conditions are `tiny = width < 60`, `small = width < 90`, actions `height > 20`, and sessions `height > 28`. Tips retain their existing condition and position. Do not unify these conditions with `home-layout.ts` in an aesthetics task. Existing model-only tests are insufficient evidence of actual visibility.

Wordmark selection is decorative only: use three rows at width ≥70 and height ≥22; otherwise bold `DAX` with the small accent rule. Copy the glyphs from `wordmark.txt`. If terminal/font validation exposes unreliable block glyphs, use the ordinary-text mark; do not ship broken glyphs or introduce a font dependency.

## Review and acceptance

1. Treat this as the recommended design for implementation; no additional functional redesign is approved.
2. Capture actual before/after TUI views for all eight states. The browser preview demonstrates composition only; final acceptance depends on the real renderer, including shared component heights and scrolling.
3. Check the selected theme plus a light and monochrome/high-contrast presentation. Brand distinction must survive without color. Never use brand color to replace semantic status colors.
4. Check long project/model names, three active/five recent runs, waiting approval with count, a failed recent run with reason, and existing scroll access. No clipped prompt, hidden actionable information, reduced click target, or row reordering.
5. Verify prompt typing/submission, Quick Start draft insertion, guide opening, existing run selection, and unchanged focus/keyboard/approval flows. Add focused behavioral/layout checks only for actual rendering risks; do not change functionality to fit a mockup.
6. Run repository-required application gates under pinned Bun 1.4.0. Push a feature branch with exact SHA, screenshots, validation results, and limitations for review. No merge or release in this task.

## Documentation review

Targeted inspection of `ceceac3..c10f48f9887968535500f7128c1f37508cd972ab` confirms the conformance README alone changes candidate/pending wording to accepted/integrated, cites `7ccfc8a`, and retains scope and content limitations. `git diff --check` passed. SHIP for that exact documentation SHA; no code gates repeated. Remote parity was reported by Sol, not rechecked for this follow-up.
