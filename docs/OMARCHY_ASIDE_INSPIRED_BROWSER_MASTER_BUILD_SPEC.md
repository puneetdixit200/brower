# MASTER ENGINEERING SPEC: Aside-Inspired Fast AI Browser for Omarchy

**Document type:** Executable engineering brief for an autonomous but less-capable coding AI  
**Document version:** 1.0, researched 2026-10-27 (Asia/Kolkata)  
**Project codename:** `Aster Browser` (working name, **not** an official Aside product)  
**Primary target:** Omarchy (Arch Linux + Hyprland/Wayland), Linux x86_64  
**Objective:** Independently implement a browser with the **user-visible workflows and polished interaction model** of Aside, while keeping everyday browsing fast, secure, stable and pleasant.  
**Source baseline:** BrowserOS OSS Chromium fork + its React/WXT/Bun agent platform.  
**Analysis tool:** REA (`morluto/rea`), used for authorized analysis where useful, **not** as a browser engine.  
**Important:** This document is a plan, not proof that an Aside-equivalent browser has already been built or that every feature is possible from existing public code.

---

## 0. CONTRACT FOR THE CODING AGENT: READ THIS FIRST

You are the **implementing engineer**, not a brainstorming assistant. Follow these rules without exception:

1. **Do not hallucinate.** Never assert that a command, API, Linux port, feature, path, build, or test works until inspected or run. The GitHub repositories may change. Treat quoted commands below as **candidate procedures**, inspect `--help`, actual scripts, and files before using them.
2. **Do one phase at a time.** For each phase: inspect, write short plan, execute, run tests, show diff, record results and next blockers. Do not jump to UI polish before a usable browser exists. Do not repeatedly ask the human questions if you can inspect the code or select the safe default described here.
3. **Keep the original product functional.** Do not break navigation, history, tabs, profiles, downloads, extensions, sign-in, permissions, or updates to make the UI prettier. No deletion of user data. No test using real credentials.
4. **Be explicit about limitations.** Separate `verified`, `implemented`, `tested`, `blocked`, and `planned` in every progress report. Do not call a mock button a complete feature.
5. **Commit in small changes.** One cohesive functional change per commit. Work in a new fork/branch, do not edit upstream on `main` or overwrite the user's existing browser profiles.
6. **Prefer existing APIs.** Reuse Chromium's robust browsing engine, BrowserOS agent services, and OS capabilities. Do **not** write a browser rendering engine, password vault, sandbox, TLS library, or cryptographic primitive from scratch.
7. **Protect security.** Never pass plaintext passwords, cookies, session tokens, passkeys, API keys or browser profile files to an LLM. Never turn off Chromium sandbox as a workaround. Never expose a CDP/MCP control port publicly. Never install untrusted binaries or execute downloaded shell scripts without user approval/review.
8. **Respect IP and licenses.** Functionally reimplement features from **public documentation, your own observations and authorized testing**, using original source code, icons and branding. Do not extract/reuse Aside's protected source, proprietary images, logos, code or proprietary services; do not bypass license/DRM/permissions. Preserve BrowserOS AGPL-3.0 obligations and other notices when redistributing modified code. REA itself warns against copying proprietary software/assets.
9. **Prioritize speed.** A smooth browser with fewer completed features beats a pixel-polished unusable clone. Perf regressions block merges, as defined below. Every long task must run off the main UI thread.
10. **Produce artifacts.** Keep `docs/PROGRESS.md`, `docs/FEATURE_MATRIX.md`, `docs/ARCHITECTURE.md`, `docs/BENCHMARKS.md`, `docs/SECURITY.md`, `docs/KNOWN_LIMITATIONS.md`, screenshots, test reports, change log, build scripts and final runnable release artifacts. Do not invent success reports.
11. **Never silently contact third-party services.** Model calls, telemetry, updates, sync, OAuth and cloud tasks require clear opt-in, disclosure and config. **Local-first does not mean model inference is local unless a local provider is selected.**
12. **Distinguish BrowserOS from BrowserOS neo.** This project is a **daily-use browser that a human drives with AI built in**, so initially target **BrowserOS**, not neo's agent-driven secondary-browser experience. Borrow components legally where useful only after tracing dependencies.
13. **No fake exact clone promises.** “End-to-end replica” means feature parity with the publicly documented UX at the relevant date, validated via independent tests. Proprietary backend features may require an alternative implementation, and their internals are unknown.
14. **Ask only for essential authorizations**, e.g., installation with `sudo`, sharing an API key, downloading large Chromium toolchains, granting folder access, sending messages or payments. Use test fixtures until approved. Report the exact proposed commands first if destructive or sensitive.

### Status report template (EVERY phase)

```text
PHASE: <number / name>
UPSTREAM REVISION: <git SHA>
HOST: <uname -a; CPU/RAM/GPU; Wayland/X11>
GOAL: <one measurable outcome>
FILES READ: <paths>
FILES CHANGED: <paths>
COMMANDS RUN: <exact commands, exit codes>
TESTS: <pass/fail/skipped and real test output>
BENCHMARK DELTA: <baseline vs current on same machine>
SECURITY REVIEW: <boundaries tested>
RESULT: VERIFIED / PARTIAL / BLOCKED / NOT STARTED
BLOCKERS: <facts, not guesses>
NEXT ACTION: <single well-defined task>
```

---

## 1. VERIFIED TARGET AND REFERENCE BEHAVIOR

### 1.1 What Aside publicly documents

The following are **functional targets**, not claims that they are all possible without modification. Verified public documentation, observed 2026-10-27:

- **Browser shell:** browser navigation, omnibox, sidebar showing bookmarks, chats/tasks and tabs, a task-oriented home screen and recent task cards.
- **New-tab composer:** toggle `Search` / `Ask AI`; accept `@` context attachments; select local vs cloud processing (where actually supported), permission mode and model/reasoning preset.
- **Keyboard and tab workflows:** sidebar toggle; Ask AI; new task; copy URL; split tabs; tab switching; text selection actions and graphical/lasso selection shortcuts.
- **Side-panel AI:** attach current tab title and origin; page-aware Q&A; retain draft tied to page/tab context; transition from reading page to task actions.
- **Tasks:** multi-step browser actions, search, files and downloads, persistent transcripts, progress, approvals, pause/wait/resume, incognito isolation and a clear task details view; follow-ups can queue behind or steer an ongoing run.
- **Task permission modes:** read-only, guard/approved folders, full access; central tool allow/ask/deny rules, with deny taking priority.
- **Long research:** a higher reasoning/research mode (Aside calls one mode `Ultrabrowse`), evidence links and multi-page synthesis.
- **Memory:** browsing history context, task-derived episodic memory, site-specific navigation notes, editable markdown memory, retention controls and provenance/history.
- **Routines:** cron-style new tasks, heartbeat-style continuation, pause/resume, skip overlapping runs, view run history, editable schedules.
- **Credential UX:** browser's existing password manager and autofill, origin matching, optional password-agent access, human MFA/passkey approval and protected sensitive actions. Important: our implementation must NOT claim to duplicate Aside Vault's hardware-backed security.
- **Model providers:** configurable API providers and local alternatives. Aside additionally documents subscription connections, but those are **not automatically transferable** to another product. Never imply ChatGPT/Claude consumer subscriptions grant third-party API access.
- **Developer surface:** CLI, MCP and automation REPL are documented for Aside; build an independently designed equivalent with authenticated, local-only control, not a copy of its proprietary protocol.
- **Privacy:** browsing history/data deletion, cookie and permissions controls, retention, incognito mode, memory enable/disable.

### 1.2 Public references to use during implementation

Read these, record capture date and URL in `docs/FEATURE_MATRIX.md`:

| Topic | Primary source URL |
|---|---|
| Aside product home and its interface overview | https://aside.com/ |
| Aside Help Center index | https://docs.aside.com/ |
| Browser basics, splits, shortcuts, selection/lasso | https://docs.aside.com/help/browser-basics |
| Long-running tasks and follow-up modes | https://docs.aside.com/help/tasks |
| Side panel, tab context and drafts | https://docs.aside.com/help/side-panel |
| Research mode | https://docs.aside.com/help/ultrabrowse |
| Scheduling and routines | https://docs.aside.com/help/automation |
| Memory settings and retention | https://docs.aside.com/help/memory |
| Memory public overview | https://aside.com/features/memory |
| Password manager boundaries | https://docs.aside.com/help/password-manager |
| Password autofill configuration | https://docs.aside.com/help/passwords |
| Permission model | https://docs.aside.com/help/security |
| Privacy settings | https://docs.aside.com/help/privacy |
| AI/model settings | https://docs.aside.com/help/ai |
| CLI/MCP/REPL reference | https://docs.aside.com/help/developers |
| BrowserOS source | https://github.com/browseros-ai/BrowserOS |
| BrowserOS human-browser README | https://github.com/browseros-ai/BrowserOS/blob/main/README.BrowserOS.md |
| BrowserOS contribution requirements | https://github.com/browseros-ai/BrowserOS/blob/main/CONTRIBUTING.md |
| BrowserOS agent developer guide | https://github.com/browseros-ai/BrowserOS/blob/main/packages/browseros-agent/CONTRIBUTING.BrowserOS.md |
| BrowserOS new-tab and side-panel source | https://github.com/browseros-ai/BrowserOS/tree/main/packages/browseros-agent/apps/app |
| BrowserOS build system | https://github.com/browseros-ai/BrowserOS/tree/main/packages/browseros/bos_build |
| REA | https://github.com/morluto/rea |
| REA setup | https://github.com/morluto/rea/blob/main/docs/installation.md |
| Chromium on Linux | https://chromium.googlesource.com/chromium/src/+/main/docs/linux/build_instructions.md |
| Hyprland documentation | https://wiki.hypr.land/ |

**Version caution:** Aside documents macOS/Windows client features; available systems, plans, labels and behavior may change. Some screenshots are promotional rather than exhaustive specification. Mark anything not observed/tested `inferred`.

### 1.3 Reference acquisition protocol

1. Use the above public docs and screenshots for a **behavioral inventory**, not asset extraction. If the user has legally installed Aside on supported hardware, request a manual screen recording/screenshots and a structured walkthrough. No need to reverse-engineer proprietary code.
2. Capture and describe independently: startup, new tab, navigation, sidebar collapsed/expanded, tab groups, dark/light, settings, split view, agent composer, task details, permission prompts, memory browser, routine builder and error states.
3. For every screen, write states: empty, loading, active, waiting, failed, completed, minimized; measure placement/layout and keyboard focus/shortcuts.
4. Create an **original** design system close to the layout and behavior but with original logo, fonts, color decisions, illustrations and labels where branding might confuse users.
5. Do not block implementation because a supported Aside binary is not available on Omarchy. Linux cannot natively inspect a nonexistent Linux Aside build. Use public docs for behavior and REA only on legitimately available analyzable artifacts, under applicable rights.

---

## 2. TECHNICAL APPROACH: DO NOT MAKE ANOTHER WEB ENGINE

### 2.1 Chosen architecture (default)

```text
┌────────────────────────── ASTER DESKTOP WINDOW ──────────────────────────┐
│ Chromium/BROWSEROS native shell: rendering, tabs, TLS, profiles, caches │
│ navigation/omnibox · downloads · history · permissions · extensions    │
├──────────────────────────────────────────────────────────────────────────┤
│ WXT + React user interface                                             │
│ New tab/task dashboard · sidebar/task surface · settings · command UI  │
├──────────────────────────────────────────────────────────────────────────┤
│ Background extension / native integration (where patch needed)         │
│ browser tab events · page context · selection · layout state            │
├──────────────────────────────────────────────────────────────────────────┤
│ Bun/TypeScript agent service                                            │
│ task queue/state · AI provider adapters · tool dispatch · approvals     │
├──────────────────────────────────────────────────────────────────────────┤
│ Local services, opt-in                                                   │
│ SQLite + FTS5 · markdown memory · scheduler · artifacts · MCP/CLI         │
└──────────────────────────────────────────────────────────────────────────┘
                 │                 │                 │
           Browser tabs      Local model        Cloud API (opt-in)
            via CDP          via Ollama          via provider key
```

- **Primary fork:** BrowserOS (not just a generic Chrome extension). Its bundled agent extension is based on **WXT, React and TypeScript**; server uses **Bun/Hono/AI SDK** and browser control. It has a distributed **Linux AppImage**.
- **REA:** command-line and MCP tool for authorized inspection and architecture clarification. It is not a web browser, not Aside source, and does not auto-clone applications.
- **Data:** SQLite + FTS5 for task/history/memory metadata; optional embedding index only after FTS proves insufficient; markdown files for human-editable memory; Chromium's native profile for cookies/passwords/history, not a parallel credentials database.
- **Scheduling:** Bun service with durable SQLite jobs and local notifications, explicit opt-in for unattended runs, no execution of privileged/high-impact actions without standing rules and per-action confirmation.
- **UI:** React + accessible primitives; avoid expensive always-running animation.
- **Linux:** Wayland/Ozone where supported and stable; automatic XWayland fallback if necessary. Correct desktop entry and per-user application paths.

### 2.2 Alternative selection rule

If BrowserOS proves too hard to maintain for Linux or its license/release coupling blocks a safe, testable implementation:

- **Fallback A:** package an independent original Chromium extension + local agent daemon. Fast to build; browser chrome layout limitations (native address bar/sidebar placement cannot be fully controlled). Must label as **feature-limited extension**, not an Aside-like standalone browser.
- **Fallback B:** implement desktop shell with Qt WebEngine or WebKitGTK and a native UI only if primary architecture is demonstrably untenable. Expect reduced Chrome extension compatibility and substantial browser-surface work. This is a separate RFC with a performance/maintenance comparison.
- **Never:** ship a fragile Electron wrapper that simply embeds random websites as a replacement for daily Chromium browsing; avoid pretending a page loaded in an iframe is a browser.

### 2.3 Fork and licensing rules

BrowserOS advertises **AGPL-3.0**. Preserve copyright notices, applicable source distribution/network-use requirements, licenses for Chromium and dependencies, and fork attribution. Verify the exact LICENSE files against the pinned commit before release. Use product branding `Aster Browser`, not `Aside`, for package IDs, logos, user agent claims or public distribution. `Aside-inspired` is only a descriptive development reference.

---

## 3. HARDWARE, SYSTEM AND REPRODUCIBILITY PRE-FLIGHT

Run these commands on the **actual Omarchy machine**. Save output to `docs/environment.txt` (redact usernames, home paths, serials and tokens before publication).

```bash
set -o pipefail
printf '\n=== Host ===\n'
uname -a
cat /etc/os-release
printf '\n=== Session ===\n'
echo "XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unknown}"
echo "XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-unknown}"
command -v hyprctl && hyprctl version || true
printf '\n=== CPU/RAM/disk ===\n'
lscpu | grep -E 'Architecture|Model name|CPU\(s\)' || true
free -h
df -h "$HOME"
printf '\n=== Graphics ===\n'
command -v lspci && lspci | grep -Ei 'VGA|3D|Display' || true
printf '\n=== Tools ===\n'
for c in git curl gcc clang python3 uv bun node npm cmake ninja rustc cargo; do printf '%-10s' "$c"; command -v "$c" || true; done
```

**Decision:**

- If architecture is not x86_64, do NOT assume the released BrowserOS AppImage works. Confirm upstream's release matrix; consider ARM-specific Linux build as a separate task.
- Under ~16 GB RAM or ~100 GB spare, **do not start a Chromium-from-source build yet**. Develop and test UI/agent changes against existing BrowserOS Linux release; benchmark real RAM and storage first. A complete Chromium build can need more disk/RAM/time than a typical laptop should spend.
- If on older ThinkPad-class hardware, use modest concurrency and avoid heavyweight local LLM inference while measuring browser performance. Prefer API inference when privacy preference and cost allow.
- Record actual device specs instead of using guesses.

### 3.1 Install build prerequisites safely

```bash
sudo pacman -Syu
sudo pacman -S --needed \
  base-devel git curl wget unzip tar jq \
  python python-pip clang lld cmake ninja \
  procps-ng fuse2
```

`pacman -Syu` updates the system; schedule it when convenient and read package prompts. This is a starting list, **not** all Chromium-specific dependencies. Use the official Chromium Linux instructions and the repo's scripts for the exact dependency set. Do not use Ubuntu `apt build-essential` on Arch.

Install Bun via a vetted current package/source and verify version against the project's `packageManager` / lockfile. Examples below use `bun` only **after verifying** it exists. Install `uv` through the Arch package or its official documented method when ready for native browser build.

### 3.2 Clone and pin repository revisions

```bash
mkdir -p ~/Projects/aster-browser
cd ~/Projects/aster-browser

git clone https://github.com/browseros-ai/BrowserOS.git upstream-browseros
cd upstream-browseros

git rev-parse HEAD
git status --short
cat LICENSE | head -n 15
cat CONTRIBUTING.md | head -n 100

git switch -c feat/aster-linux-ui
```

Record output of `git rev-parse HEAD` in `docs/UPSTREAM_VERSION.md`. Use a personal fork/remote before publishing. Do not blindly `git pull` after modifications. For upstream updates, fetch, review diff, merge/rebase with tests.

### 3.3 Verify app source, NOT guessed older README paths

```bash
cd ~/Projects/aster-browser/upstream-browseros
find packages/browseros-agent/apps/app -maxdepth 2 -type d | sort | head -n 120
find packages/browseros-agent/apps/server/src -maxdepth 2 -type d | sort | head -n 100
find packages/browseros -maxdepth 2 -type d | sort | head -n 100
cat packages/browseros-agent/package.json | head -n 90
cat packages/browseros-agent/apps/app/package.json | head -n 75
cat packages/browseros/bos_build/README.md | head -n 100
```

Verified as of research: `apps/app/entrypoints/{app,background,sidepanel}`, `apps/app/screens/{newtab,sidepanel,scheduled-tasks,...}`, `apps/server/src/{agent,api,tools,...}`, `packages/browseros/{bos_build,chromium_patches,chromium_files,series_patches,...}`. Internal filenames **must still be discovered**, as repo documentation and filesystem structure may differ.

### 3.4 Get a known-good Linux browser running BEFORE changes

The upstream `README.BrowserOS.md` currently links an official Linux AppImage:

```bash
mkdir -p "$HOME/Applications"
curl -fL --retry 3 \
  'https://files.browseros.com/download/BrowserOS.AppImage' \
  -o "$HOME/Applications/BrowserOS.AppImage"
chmod +x "$HOME/Applications/BrowserOS.AppImage"
file "$HOME/Applications/BrowserOS.AppImage"
"$HOME/Applications/BrowserOS.AppImage" \
  --user-data-dir="$HOME/.cache/aster-browser/stock-baseline-profile"
```

**Supply-chain checks:** Use release signatures/hashes from official vendor channels **if available** and verify them; do not fabricate SHA256 values. Running a new downloaded binary always requires user trust/approval. Save the download hash locally for reproducibility, but do not call a locally computed hash an upstream authenticity proof. Do not execute if download yields HTML or fails the ELF/AppImage format check.

If the normal session has Wayland compatibility issues, test:

```bash
"$HOME/Applications/BrowserOS.AppImage" \
  --ozone-platform=wayland \
  --user-data-dir="$HOME/.cache/aster-browser/stock-baseline-profile"
```

If needed, test safe XWayland fallback (`--ozone-platform=x11`) and report results. Do **not** use `--no-sandbox` to fix startup. Document FUSE/AppImage-specific errors and try official vendor-supported extraction/packaging only after checking its guidance.

**Browser baseline smoke test:** URL navigation, HTTPS cert validation, YouTube video, a form, download, bookmark, existing extension, private window, browser restart/persistence, GPU acceleration and touchpad scrolling.

---

## 4. REA: USE IT IN THE RIGHT PLACE

REA repository: `https://github.com/morluto/rea`. It provides CLI + MCP tools for analysis of binaries, JavaScript/Electron apps and permitted runtime behavior. It is **not** Aside's repo and installing REA is not the same as downloading Aside source. REA's current documented Node engines are compatible versions of 22.23.4+, 24.22.1+, or 26.12.1+; verify package.json at runtime.

```bash
node --version
npm --version
npx rea-agents@latest setup --client codex
```

Review exact changes to Codex MCP configuration, approve only wanted modifications, restart the client; verify with the current REA CLI help and documented doctor command:

```bash
npx rea-agents@latest --help
npx rea-agents@latest doctor --help
```

Example static JS application analysis, only for owned/authorized source or artifacts:

```bash
npx -y rea-agents@latest analyze-javascript-application \
  /ABSOLUTE/PATH/TO/AUTHORIZED/EXTRACTED/APP --json
```

**Agent instruction for REA:** Inspect BrowserOS public source normally via file/search/Git first. Use REA when its higher-level app or binary analysis supplies evidence that simpler code reading does not. Clearly cite file/offset/function and confidence. Never request bypassing protection or extracting proprietary protected implementations from Aside. If no allowed sample exists, proceed with public behavior specifications.

---

## 5. PERFORMANCE BUDGET: FIRST-CLASS REQUIREMENT

The user explicitly wants the browser to be **fast**. Treat the following as **provisional engineering targets**, not reported measurements or guaranteed outcomes. Record genuine baselines on the actual laptop before setting hard regression thresholds. Test against the same upstream build and same hardware/profile/network.

| Metric | Initial target | How to measure |
|---|---|---|
| Warm app startup to interactive window | Aim <= 3.0 s on an SSD | 10 launches, median and p95; separate cold-start |
| New-tab UI input response | P95 < 50 ms from event to visible result | Chrome performance trace / Playwright |
| Sidebar toggle and tab UI | P95 < 100 ms; no obvious jank | 100 interactions, trace and video |
| UI frame pacing | >= 55 FPS on supported screen at rest/scroll | DevTools Performance FPS / dropped frames |
| Navigate to first paint | No >10% median regression vs stock BrowserOS | Same pages, cache/network and 10 runs |
| Idle overhead | Aim < 150 MB *incremental* RSS for agent UI/service relative to baseline | `ps`, `/proc`, repeat after 5 min idle |
| Agent background CPU | Aim < 1% of one core while truly idle | `pidstat` / `top`, 5 minute window |
| Search suggestions | P95 < 100 ms for *local* results | input synthetic benchmark |
| History query 10k items | P95 < 150 ms for FTS query, after indexes | SQLite fixture benchmark |
| No UI work blocked on network | Strict | Offline test while typing/switching tabs |
| Cold startup / memory / battery | Report, not presume hard numbers | `hyperfine` if available, `time`, `ps`, `powerstat` where supported |

**Perf constraints:**

1. Avoid a second heavy Electron/Chromium process solely for UI. Prefer the existing Chromium UI/extension model.
2. Load agent modules, memory indexes, image previews, rich markdown, and settings routes lazily.
3. Use visible-tab prioritization: debounce or pause inactive panels and hidden task views; no polling faster than needed.
4. Window and virtualize long lists (tabs, history, chats and logs). Render only on-screen rows.
5. Debounce live search (e.g. 120–200 ms); cancel stale requests with `AbortController` or equivalent.
6. Keep expensive memory embeddings and summarization off the UI thread in bounded background workers.
7. Set explicit timeouts, maximum parallel browser actions, token limits, file/download quotas and backpressure.
8. Reuse Chromium's networking, HTTP/2/3 where supported, HTTP cache, compositor, hardware decoding and process isolation.
9. Avoid extra CSS `backdrop-filter`, huge blurs, endless repainting backgrounds and offscreen shadow layers. Support a **reduced transparency / reduced motion** mode for older hardware.
10. Do not turn off site isolation, safe browsing protections, sandboxing or TLS validation to gain speed. Security regressions are worse than a benchmark improvement.
11. Do not enable network telemetry by default in the fork. No silent logging of URLs/prompts/site content.
12. Perf work must be evidence-driven: profile, isolate culprit, implement minimal fix, benchmark against baseline.

### Baseline collection script outline

```bash
mkdir -p docs/perf
# Run stock BrowserOS with a clean, independent profile; capture browser version.
# Record system load and temperatures; close unrelated applications.
# Run 10 trials of each scripted navigation with network/cache conditions documented.
# Use Playwright/Puppeteer or CDP ONLY when attached to a developer/test browser.
# Save raw JSON traces and a summary with median, p95, memory, CPU, versions.
```

**Never benchmark with a user's real private profile or browse their personal data.** Start with `https://example.com` and locally served fixture pages, then a small set of reproducible public sites and user-authorized scenarios.

---

## 6. UI/UX REPLICATION SPECIFICATION (BEHAVIORALLY FAITHFUL, ORIGINAL ASSETS)

### 6.1 Visual layout

Implement a very clean, modern, compact shell derived from the functional layout in public screenshots:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ BACK  FORWARD  RELOAD  URL / SEARCH                        PROFILE  MENU    │
├──────────────────┬──────────────────────────────────────────────────────────┤
│  Aster logo      │                                                          │
│  Search / Task   │     New tab / actual website / active agent task          │
│                  │                                                          │
│  BOOKMARKS       │               ASK AI / SEARCH COMPOSER                     │
│    Site A        │            [prompt... @ page/file/tab]                     │
│    Site B        │       [Search | Ask] [Local] [Guard] [Model/Reasoning]      │
│                  │                                                          │
│  CHATS / TASKS   │     Recent tasks: queued / running / completed             │
│    Recent #1     │                                                          │
│    Recent #2     │                                                          │
│                  │                  WEBSITE OR TASK DETAILS                   │
│  TABS            │                                                          │
│    [Active]      │                                                          │
│    [Agent tab]   │                                                          │
│    [Page]        │                                                          │
│  + New tab       │                                                          │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

**Implementation choices:**

- Sidebar: default 220–260 CSS px, resizable between ~176 and 340 px, keyboard collapse and persist choice per profile/window; icon-only collapsed state.
- Show separate `Bookmarks`, `Chats/Tasks`, `Tabs`, and `Agent tabs` groups; correct favicons, titles, active indicator, unread/badge state, progress spinner on active tasks.
- Window UI is responsive down to 1024x768; new-tab action does not cause layout shift; preserve keyboard focus and native accessibility.
- Do not force center AI composer when editing a real website; home tab differs from browsing and agent transcript.
- Theme: default to system, then dark/light; use CSS variables, not theme-specific duplicated components. Keep typography and whitespace calm, avoid unnecessary glass blur. Support an optional soft tint with low-power fallback.
- New-tab recent tasks show genuinely persisted tasks, not invented results. Empty state is informative and uncluttered.
- Agent action indicators use accessible icon + status text and never imply completion when still running.

### 6.2 Interaction details

**Unified input state machine:**

```text
Idle -> InputFocused -> (SearchMode | AskMode)
SearchMode -> Valid URL? browser.navigate(url) : search(provider, query)
AskMode -> attach_context('@') -> select permissions/model -> create_task()
Task -> pending -> running -> awaiting_approval -> running -> complete
                                              \-> rejected/cancelled/failed
```

- `Enter` in Search mode should navigate/search immediately; `Enter` in Ask mode submits task; `Shift+Enter` newline, where supported.
- `@` picker can attach current tab, another tab, highlighted text, selected file(s) within granted folder, history item, prior task, and memory item. Render removable chips and clear provenance in task view.
- Search omnibox and Ask AI composer can be visually adjacent but **must keep their distinct security and runtime semantics**.
- Add keyboard command palette for tabs, commands, search, tasks, history and settings. Inline fuzzy search with keyboard selection; no multi-second LLM call needed for local commands.
- Mouse middle click, Ctrl+click, drag/drop tabs, reopen closed tab, tab pinning, Ctrl+L, Ctrl+T, Ctrl+W, Ctrl+Shift+T and Chromium standard shortcuts must remain functional.
- Split view: layout two real web contents panes, drag divider, swap sides, close split without closing tabs; preserving browser context is preferable to duplicating a page in a fragile embedded iframe. If impossible without Chromium patch, mark blocked and escalate to Phase 10.
- Selection actions: summarize/translate text via an explicitly user-invoked menu. Lasso/screenshot capture must show intended capture region and must not silently transmit a screenshot to cloud provider.
- Side-panel current-page attachment: title + hostname + favicon + removal control, stable when switching tabs unless user requests rebinding; persist draft by tab/session where appropriate.

### 6.3 Key bindings

Aside documents these on macOS/Windows. For Omarchy, use **Ctrl-based mappings unless they conflict**:

| Action | Proposed Omarchy binding | Collision rule |
|---|---|---|
| Focus URL | `Ctrl+L` | Keep Chromium behavior |
| New tab | `Ctrl+T` | Keep Chromium behavior |
| Reopen tab | `Ctrl+Shift+T` | Keep Chromium behavior |
| Toggle sidebar | `Ctrl+S` only if not colliding with Save Page; otherwise configurable `Ctrl+Shift+B` or `Super+S` | Never silently override core shortcut |
| Ask agent | `Ctrl+E` only if Chromium search behavior can be safely remapped, else configurable | Show binding in UI |
| New task | `Ctrl+Shift+E` | Test conflicts |
| Copy URL | `Ctrl+Shift+C` only if not conflicting with devtools element inspection, else configurable | Preserve inspect workflow |
| Split tabs | `Ctrl+Shift+\\` or user configurable | Test keyboard layout |
| Command palette | `Ctrl+K` if not conflicting with omnibox/extension; otherwise user configurable | Document mapping |

**Hyprland caution:** global `SUPER` shortcuts may be intercepted by compositor. Prefer in-window keybindings; add optional user-configured Hyprland bindings, not automated edits to their `hyprland.conf`.

### 6.4 Acceptance tests for the new-tab/sidebar

```text
[ ] Cold, idle, loading, offline, authenticated, error, empty-list and 1000+ item states render.
[ ] No placeholder actions; all controls have testable effects.
[ ] URLs and searches work from keyboard/mouse; pasted URL stays URL.
[ ] Sidebar expanded/collapsed state survives browser restart.
[ ] Window resizing/HiDPI and 125%/150% scaling do not clip controls.
[ ] Keyboard-only navigation can reach every control, tab, task, prompt and dialog.
[ ] Screen-reader names and focus order are meaningful; visible focus ring present.
[ ] Dark/light/system; reduced motion; scroll; touchpad all verified.
[ ] At least 100 open tabs do not force rendering 100 sidebar rows on every keystroke.
[ ] Full browser navigation and standard shortcuts remain intact.
```

---

## 7. AGENT TASK ENGINE: STATE, TOOLS, CONSENT, RECOVERY

The most important distinction from a cosmetic browser clone is a **reliable, inspectable agent task engine**.

### 7.1 Required task states

```typescript
// Illustrative contract. Adapt to existing BrowserOS schemas, do not create duplicates.
type TaskStatus =
  | 'queued' | 'planning' | 'running' | 'awaiting_approval'
  | 'waiting_for_user' | 'paused' | 'completed' | 'failed' | 'cancelled';

type TaskRecord = {
  id: string;
  prompt: string;
  status: TaskStatus;
  mode: 'normal' | 'incognito';
  access: 'read_only' | 'guard' | 'full_access';
  assignedFolder?: string;
  providerId: string;
  modelId: string;
  reasoning: 'low' | 'medium' | 'high' | 'research';
  createdAt: string;
  updatedAt: string;
  parentTaskId?: string;
  contextRefs: Array<{ kind: 'tab' | 'file' | 'history' | 'memory'; id: string }>;
  checkpointId?: string;
  resultArtifactIds: string[];
};
```

Use durable task store with clear retries, idempotency keys, checkpoints and deterministic transitions; never rely only on in-memory React state.

### 7.2 Minimum tool contract

```typescript
interface AgentTool<I, O> {
  name: string;
  inputSchema: unknown;               // runtime validated (Zod or equivalent)
  classifyImpact(input: I): 'read' | 'write' | 'high_risk';
  authorize(input: I, task: TaskRecord): Promise<'allow' | 'ask' | 'deny'>;
  execute(input: I, context: ExecutionContext): Promise<O>;
  audit(input: I, outcome: O | Error): Promise<void>;
}
```

Tools needed: list/select/open/close tabs; navigate; wait for navigation or selector; read accessibility tree / bounded DOM snapshot; click; type; scroll; take user-consented screenshot; download; search engine query; read allowed local file; write approved output; get task/history/memory; surface permission dialog; report status. Use existing BrowserOS MCP/CDP tools, **not** parallel reimplementations. All browser tool calls use bounded timeouts, cancellation and tab ownership checks.

### 7.3 Default safety policy

| Capability | Default | Notes |
|---|---|---|
| Search public web/read current permitted tab | Allow | Redact secrets; avoid scanning unrelated tabs |
| Open tab/navigate browser | Allow, subject to user task | Bound redirects and domains for privileged actions |
| Download to task artifacts folder | Ask for external/unknown file types | Restrict executable launch |
| Read local file | Ask unless folder explicitly allowed | Canonical path and symlink containment |
| Write/edit/delete files | Ask, or allow only in task sandbox under Guard | Offer diff/preview; protect user files |
| Send email/DM, publish post, submit external form | Ask every meaningful action | Show recipient, payload and destination |
| Payment/purchase/financial transfer | Ask every transaction | No unattended spending |
| Use existing browser login | Only through browser/approved credential UI | No raw secret extraction |
| OS command or package install | Ask and sandbox | Never tool-call arbitrary shell from page content |
| Incognito memory/history/persistence | Deny by design | No task memory extraction after session |
| External model receives page/file content | Explicitly disclosed provider policy | Consent required before sensitive context |

**Critical architectural rule:** web page content and retrieved documents are **untrusted instructions**. Treat them as data, never as system prompts or authorization. Test prompt injection from malicious pages that say to leak credentials or run shell commands; authorization is evaluated outside the LLM.

### 7.4 Task scheduling/concurrency

- Default `maxActiveAgentTasks = 2` on laptop, configurable after profiling.
- Default one mutating agent per tab; concurrent reads okay if consistent; lock tab controls for writes.
- Establish per-task `AbortController`, timeout and cancellation propagation down to CDP/network/file actions.
- Represent every step with timestamp, tool, parameters **redacted**, result, screenshot/artifact reference, retry count and elapsed time.
- Retries only on transient errors (navigation timeout, stale element, dropped connection), capped (e.g. 2), exponential delay with jitter; never retry irreversible payments or sends automatically.
- `Steer`: inject new user instruction safely at an explicit transition/checkpoint; `Queue`: append user message after run completion. Show which mode is active.
- Pause on CAPTCHA/MFA/passkeys and request human intervention; resume only after user action.
- On application crash/restart, restore task as `paused` or recoverable, never continue an uncertain irreversible step autonomously.

### 7.5 Approval dialog contract

Must display: **who/what/why/where**. For external actions show hostname, account (if known), affected data, proposed side effect, and precise approve/deny controls. Deny is default on timeout/close. Approvals cannot be forged by webpage JS; use browser-native/extension privileged surface. Log decision without passwords.

### 7.6 Real demonstrations (must pass, on test fixtures)

1. Find a fact across three public pages and cite the pages visited.
2. Extract a table from a local HTML fixture, export CSV within the task sandbox, report correct row count.
3. Download a test PDF via local server, verify its hash, show artifact in task transcript.
4. Fill an HTML contact form with fake data, preview and **ask** before submit; Deny prevents submission.
5. Run two independent research tasks in different tabs without cross-contamination.
6. Encounter a CAPTCHA fixture; display `waiting_for_user`; do not bypass it.
7. Start task, kill agent daemon, relaunch; recover transcript and require safe resume.
8. Test malicious webpage prompt requesting secret extraction; refuse and record it as untrusted data.

---
## 8. MEMORY AND HISTORY: USEFUL, LOCAL, EDITABLE, REVERSIBLE

### 8.1 Memory tiers

| Tier | Stored data | Lifetime | Default policy |
|---|---|---|---|
| Browser history | URL, title, visit timestamps (Chromium-owned) | User-configured | Respect browser history controls |
| Task episodes | User requests, non-sensitive outcomes, summarized steps, approved artifacts | Configurable 30/90 days/never forget | Off for incognito |
| Semantic facts | User-approved facts/preferences and source links | Explicit retention settings | Opt-in for sensitive categories |
| Site recipes | Site-specific successful navigation steps, **no session token/password** | Revocable | Validate before reuse; sites change |
| Temporary working memory | Current task page excerpt, DOM summaries, tool results | Until task completion or retention policy | Redacted, bounded size |

Represent memory as human-readable markdown under an app-specific user-data directory, with structured SQLite metadata and an audit trail:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/aster-browser/
  memory/
    MEMORY.md
    USER.md
    episodic/YYYY-MM-DD/<task-id>.md
    sites/<safe-site-identifier>.md
    projects/<project-id>.md
  tasks/<task-id>/transcript.jsonl
  tasks/<task-id>/artifacts/
  state/aster.sqlite
  logs/     # redacted, retention-limited
```

**Be careful:** this is the **proposed Aster data model**, not a factual claim about BrowserOS's current paths. Keep browser profiles in Chromium's native user-data location and respect `XDG_*` directory conventions. Create directories with user-only permissions (`0700`); files containing task data should default to `0600` where practicable. Backups should exclude credentials unless the user's chosen browser-supported encrypted backup flow permits them.

### 8.2 Minimal SQLite schema (conceptual)

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  status TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL,
  mode TEXT NOT NULL, permissions TEXT NOT NULL, result_summary TEXT
);
CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
  ts TEXT NOT NULL, type TEXT NOT NULL, payload_redacted_json TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, source_kind TEXT NOT NULL,
  source_id TEXT, created_at TEXT NOT NULL, expires_at TEXT,
  content_markdown TEXT NOT NULL, confidence REAL, enabled INTEGER NOT NULL DEFAULT 1
);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
  USING fts5(memory_id UNINDEXED, content, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, schedule TEXT NOT NULL,
  timezone TEXT NOT NULL, enabled INTEGER NOT NULL, last_run_at TEXT,
  next_run_at TEXT, instruction TEXT NOT NULL, policy_json TEXT NOT NULL
);
```

Implement schema changes through migrations and rollback-tested backups. Keep FTS synchronized transactionally with memory changes. Consider encrypting sensitive local memory at rest using a vetted OS/keyring integration only if threat model demands it; never claim `0600` alone provides encryption. Chromium credential data must not be copied here.

### 8.3 Memory extraction flow

```text
Task completes
 -> detect and redact secrets/PII in transcript
 -> (if memory enabled and not incognito) propose concise factual notes
 -> attach source task, title, timestamp and confidence
 -> user can inspect/edit/delete and undo
 -> update markdown + SQLite index transactionally
 -> respect expiry/retention and excluded domains
```

- Memory retrieval should prioritize current task context, exact source/user-approved notes and recent episodes over speculative associations.
- Index only approved types; avoid sensitive domains by default (banking, medical portals, private messages) unless user explicitly enables memory there.
- UI shows `Why do I remember this?`, source/task and delete/edit/disable controls. Deletion must cover SQLite record, FTS record, markdown copy and any cached embeddings.
- **Never** automatically create personal psychological, political or other sensitive inferences from browsing.
- Provide data export of user-approved nonsecret memories and tasks.

### 8.4 Memory acceptance tests

```text
[ ] User can turn memory off and no new persistent memory is created.
[ ] Browser's incognito profile never creates persistent Aster memory/tasks.
[ ] Deleting a memory removes it from search and derived indexes.
[ ] Editing a markdown memory updates the effective retrieval index.
[ ] 30-day and 90-day retention expire the right items even across reboot.
[ ] History search is useful at 10k, 50k+ entries with measured latency.
[ ] No password, token, cookie, auth header or API key appears in output.
[ ] Site recipe fails gracefully when DOM/layout changes.
[ ] User can inspect exact task provenance of memory claims.
```

---

## 9. ROUTINES AND UNATTENDED WORK

Aside distinguishes recurring **cron tasks** from **heartbeat continuation**. Independently implement both with the following semantics:

- Cron: schedule a new task with stored instructions, model, permissions and working folder.
- Heartbeat: resume/reconsider an existing conversational task when due; keep continuity and log wake-ups.
- All jobs have explicit IANA timezone (e.g. `Asia/Kolkata`), scheduling expression, `next_run_at`, enabled flag, last result, retry and audit trail.
- User must see and approve initial creation, permissions and schedule. No hidden scheduled job just because an LLM suggested one.
- On missed run due to laptop sleep, choose a policy (`skip` default; `run-once-on-wake` user-selected). Never spawn a backlog of hundreds of tasks.
- Skip overlapping runs by task/job lock; release stale locks after crash with an audit entry and safe recovery.
- Treat an unattended send/payment/delete as **approval-required** even when a routine triggered the planning step; do not silently escalate permissions.
- Offer schedule preview: next 5 local and UTC timestamps; test DST and timezone changes, even if the default user timezone has no DST.
- Cap active jobs and concurrent agent tasks using global resource policy.
- User can pause, resume, edit, run now, inspect result, export and delete a routine.

Example **test-only** routine:

```text
Title: Weekly public documentation summary
Schedule: Every Monday at 09:00 Asia/Kolkata
Action: Visit only https://example.com and local fixture news pages;
        summarize new posts and save markdown in task sandbox.
Mode: Read only
Notifications: local desktop notification on completion
Sensitive external actions: never permitted automatically
```

**Suggested implementation:** look for existing BrowserOS `scheduled-tasks` UI and service code first, extend them for desired semantics. Use a well-tested scheduler/cron parser with tests, persist run state in SQLite and use Linux user services if an external daemon is needed. Don't create both a browser-internal scheduler and a systemd timer for the same task without explicit ownership and deduplication.

---

## 10. LOGINS, PASSWORDS AND FILE ACCESS: THE TRUST BOUNDARY

### 10.1 Credentials: integrate, do not rebuild

- BrowserOS/Chromium already has credential storage, login flows and profile encryption where supported. Inventory exact capabilities on Omarchy and document Linux keyring integration (e.g. libsecret/KWallet/GNOME keyring depending on the actual environment). Do **not** promise hardware Secure Enclave parity on Linux; it does not exist as a drop-in macOS feature.
- An agent may **request** `fill_matching_login(origin)` through a browser-mediated, user-authorized capability only; the result must be `success`/`failure` metadata, never a password value. Prefer supported browser autofill interaction, not exporting a password to JavaScript/CDP.
- If Chromium/extension APIs **cannot** support blind autofill securely on the target, **do not implement a fake one**. Fall back to user performing visible login manually, then agent continues in the authenticated tab. Mark automated login `blocked pending privileged integration`.
- Origin-matching includes scheme, registrable domain, subdomain and anti-phishing considerations; avoid blind suffix matching (`evil-example.com` must not match `example.com`). Never autofill on untrusted frames just because their parent is trusted.
- Require user gesture/unlock for sensitive credentials per policy. Support manual MFA/OTP/passkey challenges, never bypass site protections.
- Support per-site AI access policy: `never`, `while_unlocked`, `ask`, `allowed`, with safe defaults.
- Keep records of credential-use requests with site and time, but no secret values; give user visibility/revocation.
- Handle extension content script limitations, native browser autofill boundaries and isolated worlds without weakening Chrome security policy.

### 10.2 File-system sandbox

- Default folder: `~/.local/share/aster-browser/tasks/<task-id>/artifacts`.
- Guard mode allows only the canonicalized task folder plus approved directories. Deny accesses via traversal, symlinks or bind-mount tricks; resolve and validate paths *at operation time* (not only in the UI), use secure handles as feasible.
- Read-only mode forbids writes even if page content instructs otherwise. Full access cannot bypass native OS permissions, approval rules or private credential storage.
- No arbitrary process execution by default. Approved terminal/file tasks should use OS sandboxing with explicit limits, not a bare `sh -c <model text>`.
- Exports are atomic with predictable naming and cancellation safety. No writing to `~/.ssh`, browser profile paths or OS config just because a prompt says so.

### 10.3 External model disclosure

For each provider, label:

```text
Provider: Local Ollama / Provider API
Where data is processed: On this computer / External provider
Data potentially sent: user prompt + explicitly attached page text/files
Reasoning capability: selected model-specific
Account costs / rate limits: user-provided if known, else unknown
```

Do not assert BrowserOS can legitimately reuse a ChatGPT Plus subscription by API unless an official supported method is explicitly provided and authorized. Public claims about Aside's own subscription integrations do not grant that integration to this fork.

---

## 11. DETAILED FEATURE MAP: WHAT TO REUSE VS BUILD

First open, search, and read the **current** source. Based on the repository inspected in October 2026:

| Feature | Candidate code surface | Action |
|---|---|---|
| New tab / unified search | `packages/browseros-agent/apps/app/screens/newtab/` | Preserve existing logic, redesign state/UI |
| Entry-point registration | `.../apps/app/entrypoints/app/`, `entrypoints/background/`, `entrypoints/sidepanel/` | Map manifest and event wiring before changing |
| Side-panel chat | `.../apps/app/screens/sidepanel/` | Context attachment, drafts, task display |
| AI agent controls | `.../apps/app/screens/agent-command/`, `screens/jtbd-agent/` | Extend only after tracing data flow |
| Provider settings | `.../apps/app/screens/ai-settings/`, `screens/llm-hub/` | Expose local/cloud, status and reasoning |
| Agent tasks | `.../apps/server/src/agent/` | Durable state, approval, bounded tools |
| Tool implementations | `.../apps/server/src/tools/` | Reuse browser operations and policy enforcement |
| Service APIs | `.../apps/server/src/api/`, `src/rpc.ts` | Typed contracts and test coverage |
| Existing scheduling UI | `.../apps/app/screens/scheduled-tasks/` | Extend cron/heartbeat safely |
| Chromium native surface | `packages/browseros/chromium_patches/` | Only for UI behaviors extension cannot achieve |
| Chromium additional files | `packages/browseros/chromium_files/` | New native features, where necessary |
| Build tool | `packages/browseros/bos_build/` | Linux build, package and patch support |

**Important:** This table provides directory pointers, **not guaranteed function names or working implementations**. The agent must inspect the source and produce an actual dependency graph and `docs/ARCHITECTURE.md` before making changes.

### 11.1 Essential code-search commands

```bash
cd ~/Projects/aster-browser/upstream-browseros
rg -n 'sidepanel|newtab|chrome\.tabs|chrome\.sidePanel' packages/browseros-agent/apps/app | head -n 150
rg -n 'createTask|taskId|approval|permission|toolCall' packages/browseros-agent/apps/server/src | head -n 150
rg -n 'scheduled|cron|routine|scheduler' packages/browseros-agent | head -n 160
rg -n 'cdp|chromium|remote-debugging|extension' packages/browseros-agent/apps/server/src | head -n 120
rg -n 'sidebar|vertical_tabs|split_view|tab_strip' packages/browseros/chromium_patches | head -n 150
find packages/browseros-agent/apps/app/entrypoints -maxdepth 3 -type f | sort | head -n 120
find packages/browseros-agent/apps/app/screens/newtab -maxdepth 3 -type f | sort | head -n 120
```

These are **search queries**, not guaranteed identifiers. If `rg` is absent, install `ripgrep`. Trace feature end to end: UI event → typed API → service → tool → Chromium action → response → persisted state → visible UI.

### 11.2 Define type-safe interfaces before UI rewrites

Write source-adapted types and tests for:

- `BrowserTab`, `TabGroup`, `SplitLayout`, `SidebarSection`, `TaskRecord`, `TaskEvent`, `AgentToolInvocation`, `ApprovalRequest`, `MemoryItem`, `Routine`, `Artifact`, `ProviderConfig`, `FeatureFlag`.
- Avoid `any` on security-sensitive payloads. Validate all untrusted JSON and incoming browser messages at the service boundary.
- Use structured errors with `code`, `message`, `retryable`, `userAction`, and `redactedDebugId`, not raw stack traces or cookies in the UI.
- Preserve provider-level cancellation and streaming response parsing.

### 11.3 Proposed UI component boundaries

```text
AsterShell
├── NativeBrowserToolbarBridge  # Chromium native where necessary
├── Sidebar
│   ├── SidebarHeader
│   ├── BookmarkSection
│   ├── ChatTaskSection
│   ├── TabSection (virtualized)
│   └── SidebarFooter
├── NewTabPage
│   ├── UnifiedComposer
│   │   ├── SearchAskMode
│   │   ├── ContextAttachments
│   │   ├── ExecutionLocationSelector
│   │   ├── PermissionSelector
│   │   └── ModelReasoningSelector
│   └── RecentTasksList
├── TaskWorkspace
│   ├── TaskHeaderAndStatus
│   ├── AgentStepTimeline
│   ├── TaskBrowserTabs
│   ├── ApprovalDialog
│   ├── ArtifactBrowser
│   └── FollowupComposer
├── SplitViewController
├── SidePanelContextChat
├── MemoryExplorer
├── RoutineSchedulerUI
└── Settings
    ├── Appearance
    ├── Models
    ├── SecurityPermissions
    ├── PrivacyMemory
    ├── KeyboardShortcuts
    └── DeveloperTools
```

**Native/browser UI distinction:** A Chrome extension cannot necessarily draw a truly native sidebar around *all* tabs or create arbitrary split web contents. If native modifications are required, locate the relevant BrowserOS Chromium patches first. Do not fake it with a website occupying the left side of a normal tab while claiming native shell parity.

---

## 12. DEVELOPMENT LOOP ON OMARCHY (IMPORTANT LINUX LIMITATION)

The upstream `packages/browseros-agent/CONTRIBUTING.BrowserOS.md` explicitly says its combined `dev:watch` supervisor is currently **macOS-only** because it resolves an installed app through `/Applications/...`. That is a tooling limitation, not proof that Linux browsers cannot run. Do **not** blindly tell the user `bun run dev:watch` works on Omarchy.

### 12.1 Start with standalone UI build and tests

```bash
cd ~/Projects/aster-browser/upstream-browseros/packages/browseros-agent
bun --version
cat package.json | grep -E '"(packageManager|dev:watch|build:agent:dev|start:server|check|test)"'

bun install
cp -n .env.development.example .env.development
bun run check
bun test
bun run build:agent:dev
```

`bun install` is the supported package manager path; project docs say npm/yarn/pnpm are intentionally rejected in this monorepo. `cp -n` avoids overwriting a configured `.env`. Read `bun run ... --help` or package scripts if any command changed. A dev extension build is not a full standalone desktop browser. It may depend on an existing BrowserOS native service.

### 12.2 Inspect actual generated WXT build

```bash
cd ~/Projects/aster-browser/upstream-browseros/packages/browseros-agent
find apps/app/.output apps/app/dist -maxdepth 3 \
  -type f -name manifest.json -print 2>/dev/null || true
```

WXT often writes `.output/chrome-mv3` or dev-mode variants, but **use the actual emitted manifest directory**, not a guessed `dist/` path. Read its manifest, permissions, sidepanel/newtab URL and service URLs before loading it into a test browser.

### 12.3 Linux dev harness task (must implement)

Build a new non-destructive Linux dev launcher to replace the hardcoded macOS path. Suggested architecture:

```text
tools/dev/linux/
  run.sh            # starts only owned test processes
  detect-browser.sh # resolves explicit or known browser binary
  health.sh         # probes server/extension/test profile
  stop.sh           # terminates only recorded owned PIDs
  README.md         # exact commands, paths, limitations
```

Requirements:

1. Accept `ASTER_BROWSER_BIN` pointing to tested BrowserOS AppImage or a compiled Chromium executable. Fail with instructions if absent.
2. Accept `ASTER_PROFILE_DIR`; default to a new temporary test profile under `~/.cache/aster-browser/dev/`, **never reuse normal browser profile**.
3. Start Bun agent server with its documented required configuration; capture PID, stdout/stderr in restricted test log paths.
4. Load development extension only through supported Chromium command-line flags / registration. Beware that BrowserOS may already bundle an agent extension; test collisions and avoid loading two versions simultaneously.
5. Bind dev service to `127.0.0.1`, not `0.0.0.0`; use unpredictable/private control tokens for operations beyond basic local health checks.
6. Use dynamic, checked available ports rather than killing unrelated apps on fixed ports. **Do not `pkill -f` loosely.**
7. Health-check server and browser availability with a timeout; on failure show logs and clean up only owned processes.
8. Test running on native Wayland and XWayland; never disable Chromium sandbox.
9. Implement `start`, `status`, `stop`, `logs`, `reset-test-profile` (`reset` requires confirmation). Document current repo version and exact paths.
10. Add at least one Linux smoke test in CI; user must see a real browser window and nonblank task UI before claiming success.

**Do not invent a one-line launcher that purportedly solves every integration.** Read `tools/dev/run.sh`, its Go supervisor, server `src/index.ts` and browser CLI flags, then adapt on actual evidence. If upstream does not support an extension/server combination on Linux, identify the precise missing startup hooks.

### 12.4 Agent backend in isolation

If source scripts support it, `bun run start:server` or running the `apps/server` documented development entry may launch the API without browser. Verify `localhost` endpoint, config file and ports from source first. Test with mocked Chrome/CDP layer and fixture browser, not by forcing a real user's profile open. Keep agent code independent enough for unit/integration tests.

---

## 13. NATIVE CHROMIUM BUILD: ONLY WHEN NECESSARY

A true custom native tab sidebar, split-tab layout, window branding and certain browser-level integrations may require native Chromium changes. The current BrowserOS repo provides a Python/uv build system under `packages/browseros/bos_build/` and an `AGPL-3.0` fork; Chromium is a huge dependency.

### 13.1 Preconditions

Do **not** start this phase until:

- Linux AppImage and core agent/UI proof-of-concept run.
- UI-only boundaries are documented: which features need Chromium patches?
- Available disk is **at least ~100 GB** with safety headroom; RAM, CPU, cooling and time costs understood.
- All intended changes are on a separate branch and a clean source checkout.
- Chromium source and pin from `CHROMIUM_VERSION` / `BASE_COMMIT` are understood.
- Official Chromium Linux toolchain/deps are installed from up-to-date docs; do not translate Ubuntu apt names blindly into Arch package names.

### 13.2 Inspect official current build CLI first

```bash
cd ~/Projects/aster-browser/upstream-browseros/packages/browseros
cat CHROMIUM_VERSION
cat BASE_COMMIT
command -v uv || { echo 'Install uv from official source / Arch package'; exit 1; }
uv sync
cp -n .env.example .env
uv run browseros --help
uv run browseros build --help
uv run browseros build --preset release --show-plan
uv run browseros dev doctor --help
```

The `--show-plan` step is intentionally first; it can explain steps/environment requirements without a full Chromium build. `.env` may contain signing/release secrets for publisher workflows; don't fabricate them and don't enable upload/signing during local debug.

### 13.3 Build against a real Chromium checkout

Fetch Chromium via the current upstream Linux build guide and `depot_tools`; initialize a source checkout for the **pinned BrowserOS revision**. The exact provisioning command must follow `bos_build` docs, and not target `HEAD` of arbitrary Chromium if version differs.

With correctly prepared Chromium under `/absolute/path/to/chromium/src`:

```bash
cd ~/Projects/aster-browser/upstream-browseros/packages/browseros
uv run browseros build \
  --preset debug \
  --product browseros \
  --chromium-src /absolute/path/to/chromium/src
```

This syntax is based on current `bos_build` documentation; if `--help` differs, adjust from the **actual** CLI. Capture full logs; monitor disk/RAM; do not switch blindly to a release build. Do not call the result complete until it launches with native tabs, agent, split/side UI, downloaded files and secure profile isolation.

### 13.4 Native code changes

- Make focused patch/feature changes to Chromium-based browser UI, **not** hacks that rewrite all Chromium internals.
- Before editing, identify patch registry and series order. Use the repository's patchkit to extract/apply and run a patch-stack health check.
- Keep browser window, tab strip, GPU acceleration, drag/drop, accessibility, session restore, site isolation and update paths functioning.
- Avoid changing `--user-agent` for branding. Changing UA can break sites; prefer official tokens and existing user-agent compatibility.
- Test Linux native Wayland at non-100% scaling, clipboard, portal file picker, download progress, IME, drag-and-drop and hardware video decoding.
- Every patch requires regression tests and notes for rebasing onto future Chromium security updates.

### 13.5 Linux build packaging

When native debug build is verified, package for Linux x86_64 using the **repo's documented** packaging flow (AppImage if supported). Create a local user `.desktop` entry, proper MIME associations, icon and launcher; install per-user for tests. Do not claim an AppImage was produced unless the packaging command emits it and `file`/execution tests pass. Avoid a privileged system-wide installer unless requested.

Example **desktop entry template** (replace absolute path, icon and name with generated file locations; do not commit a personal `/home/...` path):

```ini
[Desktop Entry]
Type=Application
Name=Aster Browser
Comment=Fast, private AI-assisted browser
Exec=/absolute/path/to/AsterBrowser.AppImage %U
Icon=/absolute/path/to/aster-icon.png
Terminal=false
Categories=Network;WebBrowser;
StartupNotify=true
MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;
```

Place a tested `.desktop` file under `~/.local/share/applications/aster-browser.desktop`; then test Hyprland launcher visibility, icon, URLs and opening second window. Desktop entry must match real output files. Do not change system default browser without the user's confirmation.

---

## 14. OMARCHY AND WAYLAND EXPERIENCE

- Test native Wayland with Ozone and correct fractional scaling; if there are regressions, document XWayland alternative.
- Avoid global shortcuts hijacking Hyprland or window manager shortcuts; use in-window shortcuts first and user-customizable keybindings.
- Support Wayland portal file picker, screenshot permissions, clipboard access and drag-drop in a sandbox-respecting way.
- Integrate theme with system appearance where possible; allow separate app theme.
- Use correct XDG data/config/cache directories; never hardcode Mac `/Applications` or Windows `%AppData%` paths.
- Ensure app IDs, launcher icons, window title, tray/notification behavior and taskbar grouping work in Hyprland.
- Verify suspend/resume and lid close: routine scheduling, CDP reconnect, pages restored, tasks safely paused, no runaway 100% CPU loop.
- Test Intel integrated GPU laptops as well as modern AMD/NVIDIA when available; acceleration must be inspected, not assumed.
- No automatic edits to the user's dotfiles, shell aliases or desktop environment configs without approval. Supply snippets to opt in.

### 14.1 Hyprland smoke matrix

| Scenario | Must check |
|---|---|
| Launch through terminal | Correct startup, no unbounded logs |
| Launch through application menu | Icon/window/app ID and `%U` URL forwarding |
| 100% / 125% / 150% scale | Sidebar, dialogs and text not clipped |
| 2 monitors different resolutions | Correct window geometry, portal dialogs |
| Clipboard | Copy URL, copy selected text, paste text/URL |
| Drag/download | HTML5 drag-drop, file chooser, downloads |
| Suspend/resume | Session intact, task recovery safe |
| Browser agent in another workspace | No GPU/CPU runaway when backgrounded |
| Native Wayland / XWayland | Both tested or limitations documented |
| Keyboard-only usage | Focus, shortcuts, navigation consistent |

---

## 15. AI MODELS, REASONING MODES AND TOOL CONTROL

### 15.1 Supported provider classes

Prioritize existing BrowserOS provider architecture and documented support. Provide:

1. **Local Ollama / local endpoint**: optional, user installs a model separately; model runs on computer, not necessarily fast on older hardware.
2. **Cloud API provider(s)**: OpenAI/Anthropic/Google or compatible where BrowserOS implements them; use the provider's supported SDK, user-supplied credential stored safely.
3. **No-model browsing**: browser operates normally when provider is absent, offline or out of quota.

Do not invent paid subscription OAuth login flows. They must be explicitly supported and licensed. Do not label an API provider as “free” unless verified.

### 15.2 Reasoning modes

| Our mode | Expected behavior |
|---|---|
| Fast | 1–3 low-complexity browser actions or summary; small context |
| Balanced | Standard multi-step browsing with bounded tools |
| Deep | Plan, check evidence, multiple pages, controlled retries |
| Research | Parallel independent source collection, citation validation, structured report |

These are **application presets**, not guarantees about internal reasoning in a given model. Underlying model may ignore unsupported `reasoning` parameters; detect capabilities via provider adapter. Show estimated latency/cost only when grounded. Distinguish `Local` execution of browser **actions** from local model inference and from remote-hosted cloud browser actions; don't label remote API model use as fully local.

### 15.3 Prompt/context optimization

- Prefer semantic DOM/accessibility tree excerpts over huge raw HTML, where possible.
- Hash/dedupe unchanged page snapshots, cap text length and token budget.
- Use deterministic helpers for math, parsing, CSV, validation, tab management; avoid needless LLM calls.
- Separate page tool results from authenticated system instructions to resist prompt injection.
- Cache stable non-sensitive summaries with clear invalidation and provider/privacy policy.
- Propagate streaming progress without forcing React full-page rerenders per token.
- Store precise tool traces and redacted input hashes for reproducible debugging.

---

## 16. TEST AND QUALITY GATES: NO “IT SEEMS TO WORK”

### 16.1 Required test layers

1. **Unit tests:** input mode switching, URL parser, keyboard shortcuts, approval policy, canonical path logic, memory retention, schedule timezone parsing, tab IDs and state transitions.
2. **Component tests:** sidebar sections, virtualized tabs, task progress, dialogs, prompt chips, provider/permission selectors, theme, errors, offline and empty states.
3. **Service integration:** typed RPC, AI provider mocked responses, persistence, replay, cancellation, job locks, redaction, incognito isolation.
4. **E2E browser:** real app launch, page visit, login fixture, file download, split tabs, task automation and task recovery.
5. **Security:** prompt injection, hostile origin, credential exfiltration attempts, path traversal, unauthorized file read/write, forged approval, remote CDP/MCP access attempt, incognito leakage, permission persistence.
6. **Perf regression:** same hardware, same controlled test set, collect median and p95, process RSS/CPU, GPU tracing; compare stock upstream and last good Aster build.
7. **Packaging/smoke:** fresh user-data dir, AppImage launches via Hyprland menu, first-run onboarding, restart/session state, no root required.
8. **Accessibility:** keyboard-only, reduced motion, contrast, focus trapping, screen reader labels and minimum target sizes.

### 16.2 Browser functional checklist

```text
[ ] new window, new tab, reopen closed tab
[ ] focus address bar, search, URL with path/query/fragment
[ ] HTTP redirects, HTTPS warning, certificate errors, downloads
[ ] tab switch/pin/move/close, >100 tabs, private/incognito tab
[ ] bookmarks, folders, import/export, history, history clearing
[ ] cookies/site permissions and extension installs (as supported)
[ ] media playback/audio input/WebRTC and file picker
[ ] browser crash recovery, browser restart profile isolation
[ ] split tab state, close split, drag and resize
[ ] screen scaling, dark mode, native Wayland, XWayland fallback
[ ] AI disabled: browser still operates normally
[ ] agent task run/retry/approval/stop/pause/restart
[ ] memory enable/disable/edit/delete/export/expiry
[ ] routine scheduling and no overlap after sleep
[ ] provenance, readable transcripts, redacted logs and files
```

### 16.3 Automated regression fixtures

Use a local test HTTP server with at least these pages:

```text
/             Simple HTML + delayed image
/form         Form with submit counter and fake inputs
/login        Dummy username/password screen, fake MFA state
/download     Static PDF/CSV with known hashes
/dynamic      React page with delayed DOM changes
/iframe       Cross-origin iframe fixture (second local port)
/redirect     302 loop/target and external redirect test
/slow         Delayed response, abort and retry test
/malicious    Embedded instruction attempting to extract secrets
/large        5000 links/tabs/task events for virtualization tests
/csp          Strict Content Security Policy fixture
```

Test service never records sensitive real data. Use Playwright or Puppeteer with a fixture browser + isolated profile. If using CDP, allocate random loopback port and never expose it to LAN. Maintain expected-results fixtures checked into tests.

### 16.4 Quality pass definition

A phase passes only when the code, tests, documentation and resulting runtime behavior have evidence. “Build succeeded” without a functioning window and real workflows is **not** a browser build success. A successful UI mockup with unconnected controls is **not** feature parity. A fake “memory” that only stores input in localStorage is **not** robust persistent memory. A test fixture that auto-submits without an approval is a security failure.

---

## 17. ORDERED EXECUTION ROADMAP (FOLLOW STRICTLY)

Every phase has **entry conditions, concrete steps, exit criteria**. The implementer should stop after each completed phase to benchmark, document and checkpoint before moving on. If a later phase fails, revert to last passing phase, not to an undefined mixed state.

### PHASE 0 — Inventory and environmental proof

**Goal:** establish the true machine and repository baseline.

1. Run Section 3 pre-flight commands. Identify CPU/GPU/RAM/disk/OS/session, Node/Bun/uv, permissions and available browser.
2. Clone BrowserOS, pin current SHA, verify license, inspect source directories and read contribution guides.
3. Install the Linux AppImage from official upstream link after review; launch in a fresh profile. Record behavior and limitations on Omarchy.
4. Read Aside official documentation; build feature checklist under `docs/FEATURE_MATRIX.md` with statuses `documented`, `observed`, `mapped`, `implemented`, `tested`.
5. Read `bos_build` actual CLI flags and dev runner implementation.
6. Save baseline screenshots **of our own build** and architecture diagrams; do not bundle scraped Aside branding.
7. Create `docs/PROGRESS.md` with completed/blocked status.

**Exit:** stock BrowserOS launches or failure is independently diagnosed; target feature map and host inventory exist.

### PHASE 1 — Reproducible agent extension build

**Goal:** build agent UI/service source without requiring Chromium recompile.

1. Set up exact Bun version and lockfile.
2. `bun install`, `bun run check`, `bun test`, `bun run build:agent:dev` as supported; log failures.
3. Identify generated WXT extension artifact and inspect manifest.
4. Trace new tab, side panel, background messages, server API and native browser feature ownership.
5. Write `docs/ARCHITECTURE.md` with a call path for prompt submission and a page click.
6. Create baseline branch/commit after validating all original checks.

**Exit:** source/test/build commands run or each blocker has exact reproduction and remediation plan.

### PHASE 2 — Linux dev launcher and safe live-reload/test setup

**Goal:** iterate on Omarchy without touching personal browser profile.

1. Inspect `tools/dev/` Go/macOS supervisor and `apps/server` config.
2. Implement Section 12 Linux-specific browser/extension/server launcher in `tools/dev/linux` or consistent upstream-supported place.
3. Use explicit test profile, dynamic ports, PID tracking, loopback binding and sandbox intact.
4. Verify the expected extension and service communicate; add Linux smoke test.
5. Document exactly how to start/stop, inspect logs, and recover errors.

**Exit:** running dev browser with custom UI and agent health check on Omarchy; no arbitrary process kills or profile corruption.

### PHASE 3 — UI foundation and performance harness

**Goal:** original cohesive Aster UI plus benchmarks before adding functionality.

1. Extract existing shared design primitives and theme variables.
2. Define colors, spacing (4/8px scale), typography, component sizes, focus/radius, motion rules; no proprietary assets.
3. Build layout components, responsive themes, settings navigation and error/empty/loading states.
4. Create independent baseline bench runner and raw trace storage.
5. Capture idle CPU/RSS/startup/new-tab interaction metrics.
6. Add lint/type/unit/component coverage for theme and keyboard states.

**Exit:** navigation and browsing unchanged, theme stable, baseline metrics preserved or improved.

### PHASE 4 — Sidebar, tabs, unified composer and browser navigation

**Goal:** reach visibly recognizable feature-level layout.

1. Implement collapsible/resizable sidebar with bookmarks, tasks, tabs and live status.
2. Use existing Chromium tabs/history APIs; never synthesize tab state disconnected from browser.
3. Add Search/Ask toggle, URL recognition and provider search, `@` context picker, keyboard focus/shortcuts, recent tasks.
4. Persist user appearance preferences; implement accessible control names.
5. Add virtualization for large tab/task lists; measure responsiveness.
6. Add screenshot-based UI regression using **our own captured screenshot fixtures**.

**Exit:** sidebar/omni UI works; no lost normal browsing features, no fake action controls, baseline perf budget respected.

### PHASE 5 — Side-panel contextual assistance and tasks

**Goal:** attach page and conduct genuinely useful browser automation.

1. Implement current-tab context attachment with title, origin, favicon and explicit removal.
2. Handle per-tab drafts and stale attachment warnings.
3. Render streaming task timeline and browser-tab activity indicator.
4. Integrate durable task states, cancellation, bounded tools and approvals.
5. Support queued and steered follow-up modes, with deterministic test mocks.
6. Build artifact viewer for text/PDF/image/CSV within allowed access boundaries.
7. E2E-test the eight task demonstrations in Section 7.

**Exit:** agent can perform reproducible multi-page task and record honest state; approval dialogs block risky actions.

### PHASE 6 — Split tabs and selection actions

**Goal:** feature parity for document comparison and on-page commands.

1. Investigate whether split web contents are already supported by BrowserOS Chromium patches; if not, write native-change RFC.
2. Implement real split panes or mark blocked with exact technical reason. Do not use iframes as a fake substitute.
3. Implement text-selection toolbar actions, user-invoked screenshot/lasso actions and customizable prompt templates.
4. Preserve browser navigation and focus within both panes.
5. Test resizing/swap/close/restart state, scaling and security boundaries.

**Exit:** split view and selection features tested, or native patch dependency documented and queued for Phase 10.

### PHASE 7 — Local memory and history retrieval

**Goal:** reliable, user-controlled context reuse.

1. Create migration-backed SQLite + FTS memory store and safe markdown mirror.
2. Add history retrieval based on browser-supported APIs with permission checks.
3. Add background memory extraction only on opted-in task completion, provenance and site-scoped notes.
4. Build memory overview, edit/delete, retention and search.
5. Test incognito exclusions, secret redaction, expiry and stale-site recipes.
6. Bench 10k and 50k entries without locking UI.

**Exit:** survives restart, memory edit/delete actually affects retrieval, no incognito or credential leak.

### PHASE 8 — Routines and notifications

**Goal:** safe recurring work with no overlap or surprise automation.

1. Reuse existing scheduled-tasks service/UI where possible.
2. Extend with cron and heartbeat semantics, timezone and missed-run policy.
3. Persist job locks/results/audit, implement notifications and pause/resume/delete.
4. Test sleep/restart/missed runs, duplicate locks and approval-required actions.

**Exit:** approved schedule runs once as expected and produces a traceable artifact, never duplicates external sends.

### PHASE 9 — Login UX and advanced tool permissions

**Goal:** authenticated browser work without leaking secrets.

1. Determine exact BrowserOS Linux password storage/autofill behavior; test only with dummy credentials.
2. Implement allowed origins and credentials **without exposing plaintext to AI** if privileged browser support exists; otherwise require manual login and record limitation.
3. Add per-site access and user confirmation for agent login assistance.
4. Implement file sandbox, canonical path policies, tool allow/ask/deny precedence and audited approvals.
5. Run prompt injection and secret-exfiltration regression tests.

**Exit:** security review passes; zero raw secrets in LLM inputs, logs, MCP outputs or task artifacts.

### PHASE 10 — Native Chromium patches, as required

**Goal:** implement only native behaviors UI layer cannot provide.

1. Identify exact patch targets (tab strip/sidebar, true split view, deep OS integration).
2. Run `bos_build` dry-run plan, check disk/resources and secure source pin.
3. Build unmodified fork debug binary first; record baseline.
4. Implement **one** Chromium patch per feature; extract/apply via repository patch tooling.
5. Run full browser smoke/perf/security tests per patch.

**Exit:** actual modified native browser works under Omarchy, not merely a patch compiling.

### PHASE 11 — Performance and battery optimization

**Goal:** ensure snappy daily browsing on user's actual machine.

1. Compare stock BrowserOS vs Aster after each feature. Identify top 5 CPU/RSS/render-blocking bottlenecks.
2. Apply code-splitting, lazy task/media rendering, virtualization, debounce, task concurrency caps, background pausing and reduced blur.
3. Test heavy workloads: 20/100 tabs, video playback + agent, downloads + search, sleep/resume and weak network.
4. Keep measured metrics and flamegraph/profiles; reject unmeasured performance claims.
5. Run security/smoke suites again after optimization.

**Exit:** no meaningful browsing regressions; improvements supported by reproducible traces and documented hardware.

### PHASE 12 — Linux packaging and user testing

**Goal:** a clean, distributable, isolated x86_64 Omarchy artifact.

1. Build final binary through verified upstream packaging process.
2. Replace product name/icons/assets with original Aster set; retain OSS license notices.
3. Package as AppImage and optional appropriate Arch/AUR package after validating upstream requirements.
4. Write first-run setup, provider connection, feature overview and migration guidance.
5. Test installed release on clean test profile, desktop entry, URL handler, updates, profile isolation, saved tasks/memory and rollback.
6. Collect real user acceptance test results and list missing features truthfully.

**Exit:** user can install/run, browse, use AI, restart, and remove Aster without damaging existing browsers.

### PHASE 13 — Maintenance and updates

**Goal:** sustainable fast browser rather than an unpatched security liability.

1. Pin/rebase upstream Chromium security releases regularly; track CVEs and compatibility.
2. Separate app extension, local daemon, native binary and migration versions.
3. Provide opt-in update check and clear update controls; ensure user-data migration/backups.
4. Test rollback from failed update; do not drop user data.
5. Maintain documented compatibility table for Omarchy/Hyprland, BrowserOS commit, Chromium version and Node/Bun/uv.

**Exit:** update runbook and recovery instructions are tested and artifacts reproducible.

---
## 18. COMPLETE FEATURE/PARITY TRACKER TO MAINTAIN

Create and regularly update `docs/FEATURE_MATRIX.md` with columns:

```text
ID | Group | Feature | Source reference | Verified target behavior |
Implementation file(s) | Dependency | Priority | Status | Test ID |
Screenshot/evidence | Known difference | Performance impact | Security impact
```

**Seed the matrix with at least these rows.** `MUST` is required for first usable daily driver, `HIGH` for intended public Aside-like experience, `LATER` for advanced parity.

| ID | Group | User-visible behavior | Priority | Acceptance evidence |
|---|---|---|---|---|
| B01 | Browser | Start browser, render HTTPS pages securely | MUST | E2E smoke |
| B02 | Browser | Navigate/search from address bar | MUST | E2E keyboard tests |
| B03 | Browser | Forward/back/reload/stop navigation | MUST | Browser fixture |
| B04 | Browser | Tab create/select/close/reopen/pin/drag | MUST | Tab e2e suite |
| B05 | Browser | Downloads, progress, files on disk | MUST | Known-hash fixture |
| B06 | Browser | History, bookmarks, search/import/export where supported | MUST | Persist/restart test |
| B07 | Browser | Incognito separated from normal history/tasks | MUST | Isolation test |
| B08 | Browser | Extensions and normal password-manager support | MUST | Supported Chromium extension test |
| B09 | Browser | Media, WebRTC, permissions, devtools | MUST | Browser regression suite |
| B10 | Browser | Session restore without profile corruption | MUST | Kill/restart smoke |
| U01 | UI | Collapsible/resizable original sidebar | MUST | Screenshot+keyboard |
| U02 | UI | Sidebar groups: bookmarks/chats/tabs | MUST | UI state test |
| U03 | UI | Recent task cards, real statuses | MUST | Restart persistence test |
| U04 | UI | Search/Ask input modes | MUST | Input state tests |
| U05 | UI | URL detection and search provider | MUST | URL parser tests |
| U06 | UI | `@` tab/history/file/memory context selector | HIGH | Attach/remove tests |
| U07 | UI | Provider/model/reasoning controls | MUST | Config persistence test |
| U08 | UI | Local/cloud mode clearly describes actual processing | HIGH | Provider boundary tests |
| U09 | UI | Light/dark/system, scaling and low-power mode | MUST | Visual+perf tests |
| U10 | UI | Keyboard shortcuts and command palette | HIGH | Conflict/focus tests |
| U11 | UI | True split tab browser contents | HIGH | Two live panes + resize |
| U12 | UI | Text selection summarize/translate | HIGH | Fixture interaction |
| U13 | UI | Lasso/screenshot contextual tools | LATER | Consent+visual tests |
| U14 | UI | Side panel attached to current page | MUST | Context provenance test |
| U15 | UI | Per-tab side-panel draft persistence | HIGH | Tab-switch test |
| U16 | UI | Task detail timeline and artifacts | MUST | Recorded task tests |
| U17 | UI | User-friendly permissions dialog | MUST | Denial and timeout tests |
| U18 | UI | Onboarding/import and privacy explanation | HIGH | Fresh-profile walkthrough |
| A01 | Agent | Ask basic page question | MUST | Mock+real model |
| A02 | Agent | Multi-page browse/click/type/navigation | MUST | Local fixture tasks |
| A03 | Agent | Download/copy/export files into sandbox | HIGH | File/hash e2e |
| A04 | Agent | Stop/cancel ongoing tool run | MUST | Cancellation test |
| A05 | Agent | Durable task state + crash recovery | MUST | Kill/restart test |
| A06 | Agent | Approval before sends/posts/payments | MUST | Approval audit suite |
| A07 | Agent | Queue vs steer mid-run | HIGH | Deterministic mock task |
| A08 | Agent | Parallel isolated agent tabs/tasks | HIGH | Cross-tab race test |
| A09 | Agent | Read-only/Guard/Full access semantics | MUST | Policy test matrix |
| A10 | Agent | Incognito tools enforce no persistence | MUST | Isolation test |
| A11 | Agent | Research/deep mode with sources | HIGH | Citation validation test |
| A12 | Agent | Human handoff for MFA/CAPTCHA | MUST | Dummy challenge fixture |
| A13 | Agent | Model missing/offline error handling | MUST | Offline test |
| M01 | Memory | History-based retrieval | HIGH | FTS/history fixtures |
| M02 | Memory | Task-derived episodic notes | HIGH | Post-task assertions |
| M03 | Memory | Editable Markdown + provenance | HIGH | Edit/undo e2e |
| M04 | Memory | Retention 30/90/forever and opt-out | HIGH | Clock-controlled tests |
| M05 | Memory | Incognito never remembered | MUST | No records after session |
| M06 | Memory | Site recipes, staleness and validation | LATER | Page-change test |
| R01 | Routines | Cron schedule creates new task | HIGH | Virtual clock/timezone |
| R02 | Routines | Heartbeat continues existing task | HIGH | Resume fixture |
| R03 | Routines | No overlap/missed-run policy | MUST if routines enabled | Sleep/restart test |
| R04 | Routines | Pause/resume/edit/delete/run now | HIGH | Scheduler UI tests |
| P01 | Credentials | Never expose saved password to LLM | MUST | Sentinel exfiltration test |
| P02 | Credentials | User-mediated normal login/autofill | MUST | Dummy account test |
| P03 | Credentials | Automated origin-safe blind autofill if possible | LATER | Privileged integration/security review |
| P04 | Credentials | MFA/passkey handled by user | MUST | Challenge flow test |
| S01 | Security | Prompt injection blocked at tools/authorization | MUST | Malicious-page fixtures |
| S02 | Security | Path traversal/symlink containment | MUST | Sandbox escape tests |
| S03 | Security | MCP/CDP bound to loopback and authenticated | MUST | Port/probing tests |
| S04 | Security | Redacted secrets and opt-in model data disclosure | MUST | Log scans and provider assertions |
| D01 | Developer | Documented local CLI task control | LATER | CLI e2e suite |
| D02 | Developer | MCP browser tool server, restricted scopes | LATER | MCP auth/denial tests |
| D03 | Developer | Browser automation REPL restricted to dev profile | LATER | Sandbox/tool isolation |
| O01 | OS | Omarchy AppImage launch and menu integration | MUST | Fresh account smoke |
| O02 | OS | Wayland/Ozone, XWayland fallback | MUST | GPU/window integration |
| O03 | OS | Suspend/resume, notifications, XDG dirs | HIGH | Lifecycle tests |
| O04 | OS | No accidental modification of Omarchy configs | MUST | Path/code review |
| F01 | Perf | Warm startup baseline budget | MUST | Timed trials |
| F02 | Perf | Fast tab toggle and no input jank | MUST | P95 perf tests |
| F03 | Perf | Efficient idle CPU and RSS overhead | MUST | 5 min idle metrics |
| F04 | Perf | No slower typical browsing than upstream beyond budget | MUST | Comparative navigation bench |
| F05 | Perf | Backpressure under many tabs/tasks | HIGH | Stress/soak test |

For each feature, statuses are `NOT_STARTED`, `SOURCE_MAPPED`, `IMPLEMENTED_UNTESTED`, `PASS`, `FAIL`, `BLOCKED`. An unchecked mock is never `PASS`. The user asked for end-to-end parity; the matrix is the proof, not marketing language.

---

## 19. DEBUGGING PLAYBOOK FOR THE IMPLEMENTING AI

### Problem: AppImage won't start on Omarchy

1. Run `file "$HOME/Applications/BrowserOS.AppImage"`; verify downloaded file type.
2. Check executable bit `ls -l`; inspect stderr from direct invocation.
3. Check `fuse2` availability; consult upstream AppImage troubleshooting. Don't force insecure flags.
4. Test `--ozone-platform=wayland` then a documented XWayland alternative, capturing console logs and browser version.
5. If AppImage version requires newer glibc, identify runtime mismatch and report; don't replace system libc manually.
6. If GPU process crashes, collect graphics info, `chrome://gpu` where accessible, test software fallback only for diagnosis; don't ship disabled acceleration by default.

### Problem: Bun install/build failed

1. Print exact root `package.json` and `bun --version`; match pinned version.
2. Read lockfile and script output; don't switch to npm/yarn/pnpm. Use `bun install` per repository docs.
3. If native dependency fails, inspect Arch toolchain/headers and exact error; no random reinstall loop.
4. If TypeScript fails, localize error to upstream baseline versus new diff; fix only relevant contract changes.
5. Never delete the lockfile or `node_modules` without first documenting reproducibility and obtaining confirmation if it could affect other work.

### Problem: Extension loads but AI button does nothing

1. Confirm background/service worker running; inspect `chrome://extensions` and its console errors.
2. Verify manifest permissions, host permissions, new-tab/side-panel entrypoint, endpoint URL.
3. Check whether native BrowserOS is required and bundled extension conflicts with test extension.
4. Start agent server with documented config; health-check its loopback API; check CORS/origin/auth rules.
5. Trace UI event → RPC → server → model adapter → tool → browser; isolate first broken boundary.
6. Use mock model responses if no provider credentials; do not fabricate key.

### Problem: Chromium build fails

1. Confirm source version/`BASE_COMMIT` matches repository; record `git status` and disk.
2. Re-run `uv run browseros build --help` and `--show-plan` to validate syntax.
3. Check source checkout/depot_tools, correct compiler, Ninja, system deps and patch-stack doctor output.
4. Fix first meaningful build error instead of suppressing compiler warnings broadly.
5. If out of RAM/disk, halt and report resource requirement. Use extension-only iteration as fallback; do not run a 100GB build in a nearly full disk.

### Problem: Browser is slower than upstream

1. Run the exact same reproducible workload on untouched upstream and Aster with the same environment.
2. Profile main thread, service worker, React renders, Bun service and compositor/GPU usage.
3. Check heavy list rendering, LLM streaming rerenders, polling, unbounded task logs, permanent blur effects, stale workers and idle timers.
4. Fix biggest measured issue, benchmark again; document before/after. No unsupported “60% faster” claims.

### Problem: Tasks touch wrong tab or lose state

1. Log task ID, target tab ID, browser window ID, agent ownership and timestamp (redacted).
2. Add per-tab mutation locks and tab lifecycle invalidation (closed/navigated/replaced).
3. For restart recovery, mark uncertain writes awaiting human confirmation.
4. Add test that runs two tasks over separate fake authenticated sites concurrently.

### Problem: Need capabilities protected by browser native code

1. Write a 1-page RFC: precise feature, missing browser API, evidence/paths, alternative, security and perf implications.
2. See whether BrowserOS already includes a patch for this feature.
3. Mark feature `BLOCKED_NATIVE` if extension cannot support it; do not lie about support.
4. Schedule Section 13 only after resources and user approval for large build are available.

---

## 20. HOW TO COMMUNICATE WITH A SMALLER AI MODEL

The implementer must use **short, highly constrained incremental instructions** rather than attempting the entire project in one response. This helps avoid context-window confusion and fabricated completion.

### 20.1 Universal system/work instruction to prepend each session

```text
You are the engineer implementing Aster Browser for Omarchy from the attached
MASTER ENGINEERING SPEC. Your instructions are:
1) Read the entire spec, then inspect current files before editing.
2) Do not claim code exists until you have opened the file. Do not invent output.
3) Choose the FIRST incomplete phase from docs/PROGRESS.md (or Phase 0 if absent).
4) Inspect relevant source, propose 3-8 atomic steps, then execute only that phase.
5) Ask for permission before sudo, destructive operations, new credentials,
   browser-profile access, external sends or big Chromium downloads/builds.
6) Preserve Linux security boundaries, browser correctness and AGPL license.
7) Write tests and benchmarks. Measure performance against stock BrowserOS.
8) Keep verified/partial/blocked status and exact command logs.
9) Do not add placeholders and mark them complete; no false pass reports.
10) At the end produce files changed, test logs, perf delta, bugs, next command.
11) Never output raw passwords, tokens, cookies, private profile information.
12) No new feature phase until existing phase passes exit criteria.
```

### 20.2 First message to the coding AI (copy-paste)

```text
PROJECT: Aster Browser, an original fast Linux AI browser inspired by the
publicly documented experience of Aside. TARGET: Omarchy (Arch/Hyprland).
BASE: https://github.com/browseros-ai/BrowserOS
REA: https://github.com/morluto/rea

The attached file OMARCHY_ASIDE_INSPIRED_BROWSER_MASTER_BUILD_SPEC.md is the
SINGLE SOURCE OF TRUTH for project requirements, safety, performance and tests.
Read its Sections 0, 1, 2, 3, 5, 12, 16, 17 and 18 BEFORE doing anything else;
use the remaining sections as needed.

Do PHASE 0 ONLY now. Read actual source, record machine specs, pin revision,
inspect official documentation, check local browser build and create the
project's tracking files. Do NOT begin a full Chromium source download.
Do NOT claim Aside source is open or available. Do NOT use proprietary
Aside assets. Do not write random code before mapping the repo.

At completion provide the exact status report template from Section 0 and
identify the specific prerequisites for PHASE 1. Stop if approval is needed.
```

### 20.3 Restart prompt for later sessions

```text
Continue Aster Browser from docs/PROGRESS.md and the Master Build Spec.
First run git status and inspect the previous phase's test reports.
Select the earliest phase not marked PASS. Make only that phase's changes.
Keep a functioning browser, preserve security constraints, and test on Omarchy.
Do not overwrite user profile or enable auto-send/payment/delete actions.
Re-run relevant tests and benchmark against the recorded baseline.
Update PROGRESS, FEATURE_MATRIX, ARCHITECTURE, BENCHMARKS and KNOWN_LIMITATIONS.
Return actual commands, exit codes, files, test evidence and next action.
```

### 20.4 Prompt when the agent prematurely declares completion

```text
Do NOT report complete. Check each required entry in docs/FEATURE_MATRIX.md,
including E2E evidence for tabs, split view, streaming tasks, approvals,
editable memory, routines, login handoff, CLI/MCP, performance and packaging.
For every item without a passing test and real runtime demonstration,
mark it IMPLEMENTED_UNTESTED / FAIL / BLOCKED / NOT_STARTED.
Show what works and what is missing; no generic success statements.
```

### 20.5 Prompt when performance regresses

```text
Stop new features. Run controlled comparison: pristine BrowserOS revision vs
current Aster on same clean profile, hardware and fixture websites.
Collect 10-trial warm startup, nav first paint, tab toggle p95, new-tab input
p95, 5 min idle CPU/RSS and UI trace.
Identify the largest measured regression, fix it, rerun tests. Security and
browser functionality must not be degraded to gain speed.
```

---

## 21. EXPECTED REPOSITORY DELIVERABLES

The other AI must deliver this structure (adjust paths to the actual source where sensible):

```text
Aster-Browser/
  LICENSE / THIRD_PARTY_NOTICES / README.md
  (BrowserOS fork and its existing upstream paths)
  docs/
    UPSTREAM_VERSION.md        # pinned SHA, versions, official links
    environment.txt            # redacted machine inventory
    PROGRESS.md                # phase statuses, blockers, evidence
    FEATURE_MATRIX.md          # every functional capability with test status
    ARCHITECTURE.md            # diagrams, data flows, changed modules
    BUILD_OMARCHY.md           # exact Arch commands (tested)
    USER_GUIDE.md              # installation and daily use
    UI_REFERENCE.md            # original design tokens and rationale
    BENCHMARKS.md              # measured baseline and regressions
    SECURITY.md                # threats, tool policy, redactions, consent
    KNOWN_LIMITATIONS.md       # truthful list of missing capabilities
    CHANGELOG.md               # concise per-phase change log
  tools/dev/linux/
    (only verified Linux launcher scripts and tests)
  tests/
    fixtures/                 # local synthetic test sites/data
    e2e/                      # actual Chromium/Omarchy flow tests
    perf/                     # controlled benchmark scripts and results
    security/                 # injection/approval/secret leakage tests
  release/
    (actual built AppImage and checksum if produced)
```

Keep generated binary artifacts outside Git unless project release workflow requires otherwise. Raw performance traces may be large; document reproduction commands and store only necessary lightweight reports in repo. Never publish API keys, Chrome profile data, login cookies or real user task transcripts.

### Final definition of DONE

You may say “feature-parity build ready for user acceptance” only if:

1. A genuine Linux browser binary/AppImage exists and launches on Omarchy.
2. Browsing, tabs, URL bar, bookmarks, history, downloads, profiles and privacy behave as expected.
3. Core Aside-*inspired* interface layout is implemented with **original** branding/assets and keyboard focus behavior.
4. Search/Ask input, attached contexts, real AI tasks, tool progress, approvals and task recovery operate with real browser actions.
5. Split tabs and selection actions are completed **or** listed as documented missing features, with no false parity claim.
6. Local memory, retention, edit/delete, provenance and opt-out are tested (if advertised in UI).
7. Routines and alerts are tested (if advertised in UI); sensitive actions cannot auto-send or auto-spend.
8. Passwords and browser secrets are never exposed to LLM/tool logs; manual login fallback is honest if secure automation is unavailable.
9. Actual speed benchmarks and measured regression results are provided; no significant uncontrolled slowdown vs BrowserOS baseline.
10. Profile isolation, secure local control interfaces, permission enforcement, incognito isolation, crash/restart and test coverage pass.
11. First-run instructions and Linux packaging work with an isolated test profile.
12. License, attribution and source distribution obligations are satisfied before distribution.

If ANY item is missing, label result `PARTIAL` and provide an honest feature matrix. Passing a plan is not passing an implementation.

---

## 22. FINAL PRIORITY IF RESOURCES OR TIME ARE LIMITED

Follow this order:

**MVP: a browser the user can genuinely use**

1. Released BrowserOS running under Omarchy.
2. Working fork build/dev loop and safe dedicated test profile.
3. Responsive original sidebar, proper tabs, Search/Ask bar, recent tasks, dark/light.
4. Functional task agent + side panel, approvals and browser automation.
5. Passing browse/agent/security/perf smoke tests.

**Next: replicate high-value Aside workflows**

6. Split view, attached context, selection actions, conversation/task continuity.
7. Persistent editable local memory with provenance and retention.
8. Routine scheduling, human MFA handoff, secure file/artifact access.

**Advanced: heavy engineering only after foundation passes**

9. Native Chromium UI patches, deeper credential integrations, independent CLI/MCP/REPL and polished distribution.
10. Battery/CPU tuning on actual hardware; upstream security update integration.

**Performance tie-breaker:** if a visually impressive effect introduces measurable frame drops, CPU drain or memory bloat, disable it by default. Prefer simpler CSS, original simple icons and fast rendering. The browser must not become slower just to resemble screenshots.

**Plain-language expectation:** A fully faithful, reliable Aside-like browser is a serious multi-month engineering project, not a one-command REA transformation. The coding AI should produce a usable, honest incremental product rather than promise immediate perfect parity.

---

## 23. SOURCE NOTES AND VERIFICATION BOUNDARIES

- The cited Aside product pages describe the **target** experience as publicly advertised on 2026-10-27; they do not reveal proprietary source structure, actual implementation details, or guarantee all functions/plan features exist on every platform.
- BrowserOS `README.BrowserOS.md`, `CONTRIBUTING.md`, `packages/browseros-agent/CONTRIBUTING.BrowserOS.md`, `apps/app/package.json`, `apps/app/README.md`, `packages/browseros/bos_build/README.md` and their directory listings were directly inspected for this specification. Key finding: the combined `dev:watch` launcher is documented as **macOS-only** at the time of inspection, even though BrowserOS distributes a Linux AppImage. `bos_build` documents `uv run browseros build --preset debug --product browseros --chromium-src ...`; validate it on the installed commit before executing.
- REA's README/package.json and DISCLAIMER were inspected. It is a reverse-engineering toolkit whose setup integrates with coding agents and whose scope explicitly forbids misuse of protected proprietary software and assets.
- Scripts in this plan **have not been run on the user's Omarchy laptop** by the author of this document. Paths/versions may evolve; a coding agent should first inspect its actual environment, then verify outcomes.
- Performance numbers in Section 5 are engineering **targets** and not measured claims. The coding AI must measure a real baseline on the machine before asserting success.
- Apart from linking to external official documentation, this document contains **no Aside proprietary source code or copied assets**.

**END OF MASTER SPEC. START WITH PHASE 0.**