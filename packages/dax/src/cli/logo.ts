/**
 * The DAX wordmark, one row per line of the block letterform.
 *
 * There used to be a second `right` face and a `marks` alphabet (`_ ^ ~`) for
 * half-block shading, and a renderer built to composite the two. `right` was
 * five empty strings and the artwork only ever used `▓`, so the whole two-tone
 * path was dead and what shipped was a flat grey wordmark. The mark is drawn in
 * the brand ramp now; see UI.logo.
 */
export const logo = [
  "▓▓▓▓▓   ▓▓▓▓▓   ▓▓  ▓▓",
  "▓▓  ▓▓ ▓▓   ▓▓   ▓▓▓▓ ",
  "▓▓  ▓▓ ▓▓▓▓▓▓▓    ▓▓  ",
  "▓▓  ▓▓ ▓▓   ▓▓   ▓▓▓▓ ",
  "▓▓▓▓▓  ▓▓   ▓▓  ▓▓  ▓▓",
]

/** Brand ramp, from dax-logo.svg: violet into blue. */
export const BRAND_RAMP = { from: [0x7a, 0x4d, 0xff], to: [0x4f, 0x7b, 0xff] } as const
