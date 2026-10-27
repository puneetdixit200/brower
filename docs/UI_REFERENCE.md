# UI reference and design rationale

## Behavioral references

Public Aside documentation (captured 2026-10-27) describes a new-tab Search/Ask AI composer, `@` context attachments, sidebar, task cards, side-panel page context, split tabs, selection actions, permission modes, memory, and routines. See the source links in `FEATURE_MATRIX.md`.

## Original design constraint

Aster must use its own name, iconography, typography, tokens, and illustrations. Aside references are behavioral only. No Aside asset or protected source is included.

## Aster home foundation (2026-10-27)

- The home screen uses an original dark-green / pearl / leaf palette scoped to `.aster-home`, with a corresponding dark palette. It does not replace global browser settings colors.
- The home screen has an explicit Search / Ask AI switch. Search opens HTTP(S) URLs or bare hostnames directly and sends other input as a Google query. Unsupported schemes are treated as search text.
- Ask AI keeps the existing provider and agent composer, attachment picker, selected-tab context, recent sites, and schedule cards. Upstream promotional cards were removed from this surface.
- The sidebar header, new-tab personalization header, and extension toolbar icons now use an original Aster mark. WXT manifest name, description, and action title read Aster Browser / Ask Aster. The inherited extension key, updater, telemetry, and upstream integrations remain and must be resolved before distribution.

This is an implemented UI foundation, not feature parity. The supervised BrowserOS v0.51.0 runner renders the Aster home after waiting for extension registration. A headed Linux smoke verified Search/Ask controls and submitted a search that opened the expected Google query in a new tab. Screenshot: [`aster-home.png`](screenshots/aster-home.png). No AI provider was configured, so task execution remains unverified. See [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md).
