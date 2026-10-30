# Console visual and browser audit

## Findings

- Desktop Chrome at the default viewport rendered the rejected historical record. Hero hierarchy, recorded scope, decision stamp, fixed-record banner, status cards, stage navigation, provenance, and footer were visible.
- Accessibility tree showed a labeled native case selector, five anchor links, semantic headings/sections, status text, and public JSON link. Only two supported cases are selectable.
- Skip link, focus styles, 44px targets, `aria-live` announcements, and reduced-motion CSS are present by source inspection and regression assertions.
- Narrow-screen CSS rules exist at 840/640/620/380px; grids are shrink-safe and hashes wrap. The 320px/tablet viewport override was blocked because local browser use was disabled in Work settings; no responsive screenshots were captured, so responsive visual acceptance remains pending.
- Sampled base, muted, rejection and warning text/background pairs passed 4.5:1 using the Antislop contrast checker. This is a sampled check, not a complete color/state matrix audit.
- Browser integration tests cover case routes, unknown/mismatched IDs, traversal rejection, security headers, HEAD/405 and safe DOM rendering. Focused suite passed 58/58.

## Evidence limitation

The P04 card that suggested a verified accepted control is omitted while strict verification is unavailable. Historical fixture bytes remain unchanged for provenance/regression work; no accepted P04 case is served.

## Remaining visual checks

Before public release save actual screenshots at desktop, tablet, and 320px; complete the text/background color-state matrix; verify keyboard-only selector/nav/copy, malformed/unavailable JSON behavior, and deployed headers/path-prefix behavior. Screenshots do not establish acceptance or real inference.
