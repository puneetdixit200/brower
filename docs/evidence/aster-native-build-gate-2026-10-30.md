# Native build-state recheck — 2026-10-30

Read-only audit of `/home/puneet/Projects/aster-browser/chromium-aster-dev/src`:

- Chromium HEAD: `16c3e55476d3564bea713314b2fff638749ce3e6`.
- Native checkout: 283 modified and 36 untracked entries (319 porcelain rows). No native files were changed.
- `out/Default_aster_x64`: 8.2 GiB and 14,252 generated `.ninja` fragments.
- `build.ninja` SHA256: `34af08970f0001b6f991e39ba068238de875743c0f03dad44a72e02e2088b03e`.
- `.ninja_deps` SHA256: `5b31092725c02f271719d5b25e72a34d764a3f7dfac966686e9e501ccd00eb32`.
- `args.gn` SHA256: `60390aad2d71fb8334132107ea528adab29888a320ea29a1e0b1ec7380ca1849`.
- No `.ninja_log` was found under the Aster project. No linked `chrome`/`chromium` executable was present; a generated headless resource pak is not browser evidence.
- No Ninja, autoninja, GN, or BrowserOS build process was running. The existing empty lock file `/home/puneet/Projects/aster-browser/chromium-aster-dev/.browseros-build-locks/src-0bf2808ad004.lock` had no process holder; lsof was unavailable and fuser returned empty.
- Host at inspection: 14 GiB RAM, about 4.7 GiB available, 29 GiB swap with about 9 GiB used; 255 GiB free on `/home`.

The generated build graph and dependency database do not replace Ninja's paired output-completion/timing ledger. Reconstructing `.ninja_log` from unrelated timestamps or another checkout is unsafe. Earlier documented dry-runs without the log scheduled 3,017 actions for a small Crashpad target and 12,115 for `external_provider_impl.o`; do not repeat those dry-runs or begin this build.

The safe next step is a read-only search of available backups/snapshots for the exact `.ninja_log` paired with this output snapshot, and verify graph/output identity before any restoration. If no exact match exists, use a separate clean pinned build host and output directory with resources measured before build. The previous bounded B03 syntax/object compile remains source-level evidence only and does not make this tree incrementally buildable or produce an Aster browser.
