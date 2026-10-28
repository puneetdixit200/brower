# Aster: source foundations for the original 38 NOT_STARTED features

Date: 2026-10-28. Branch: `feat/aster-linux-ui`.

## User instruction and evidence boundary

The user requested partial implementation of all 38 remaining NOT_STARTED rows and expressly deferred testing. Work is committed directly through the authenticated GitHub connector because this environment cannot clone `github.com` through Git/DNS or access the host's local Omarchy/Chromium tree. **No tests, typechecks, builds, Chromium compilation, headed GUI acceptance, benchmark runs, release-signing or native packaging were run in this batch.** Existing earlier evidence applies only to its own pinned revisions.

The scope below consists of source-level foundations. A row marked PARTIAL does **not** mean it meets its full requirement. It means there is an identifiable implementation route and non-placeholder source work, with the missing acceptance contract recorded in `FEATURE_MATRIX.md`. Existing feature rows remain 2 PASS and S05 PARTIAL/BLOCKED.

## Browser and navigation foundations

- `BrowserQuickControls.tsx` is wired to Aster home and uses real Chrome APIs for user-entered URL/search, new tab, explicit chosen-tab activation and reload, recent history, downloads with numeric state/bytes, and browser settings.
- User-scoped session restore uses `chrome.sessions.getRecentlyClosed` and `restore` only for a tab in the current non-private window. It does not claim crash-restore protection.
- User-confirmed screenshot capture uses `captureVisibleTab` and native Downloads, with `activeTab` permission and an explicit confidentiality warning; it does not automatically send pixels to an AI model.
- The UI distinguishes normal and incognito windows conservatively, with no history/download browsing or screenshot flow in private windows.
- The updated WXT manifest requests `sessions`, `activeTab`, and `idle` for the specific features listed. Those permissions require extension/runtime review.

## Model selection, privacy and onboarding

- `ProcessingDisclosure.tsx` classifies the actual connected target as cloud-backed, custom, self-hosted-capable or coding-agent runtime. It does not assert that Ollama or LM Studio is local merely from its provider type.
- The home composer displays live model disclosure; first-run AI onboarding explains model routing, attached page context, external provider retention and native credential boundaries.
- Existing provider selection and reasoning configuration remain the basis for model configuration; source work in this batch does not establish that every model/reasoning setting is honored at runtime.

## Human control and agent reliability

- `HumanLoginHandoff.tsx` allows the user to stop a live agent run and take over login, CAPTCHA, passkey or MFA entry on an attached current-window website tab. No secrets are read or typed by this interface; tool replay does not resume automatically.
- `Chat.tsx` now has an explicit in-memory queue of up to five prompts, drained after a completed run. Stop discards remaining queued prompts. This is **not** in-flight steering or durable crash recovery.
- `ConversationRuns` limits active conversations to four by default, with a bounded configuration override. Excess tasks return an explicit 429 from ChatService instead of creating unlimited browser/model work.
- `research-request.ts` prepares source-aware, user-initiated research requests using only user-attached HTTPS URLs with query/fragment removed. This is source seeding and agent guidance, not an independent citation verifier.

## Persistent data and file boundaries

- The task report exporter can now save to a folder picked directly through Chromium's File System Access picker; it never accepts an agent-specified arbitrary path or copies raw tool input/output.
- `site-recipe-store.ts`, `site-recipes.ts` and `SiteRecipesPanel.tsx` add local, opt-in recipe storage with HTTPS-origin binding, user-authored instructions, explicit editing/deletion, 30-day stale state and manual revalidation. No recipe executes unattended.
- `credential-tool-filter.ts` filters named credential-retrieval/autofill tools from the model's MCP tool catalog. This is additional defense, **not proof** that all DOM, external connector or native credential paths are isolated.
- No password manager vault reads, blind autofill, passkey extraction or MFA token capture were added.

## Developer and platform integration

- `aster_task_cli.py` offers local status and explicit stop. The new `/devcli` API returns status/count metadata only and requires the existing configured MCP bearer token. No token means CLI is disabled.
- Unleased external MCP clients are read-only by default. Internal conversations retain server-authorized lease policy. This reduces external access scope but does not replace an end-to-end MCP security audit.
- `aster_dev_repl.py` starts a disposable profile and a loopback CDP endpoint, supporting only tabs/open HTTPS/activate/close/quit. It cannot run shell, Python, eval or arbitrary JS, and never points at a real user profile.
- The managed Omarchy launcher now accepts `--ozone auto|wayland|x11`. It does not modify Hyprland configs, user defaults or existing profiles, and it cannot install a binary which has not been built.
- The extension's idle-to-active listener reconciles scheduled job history and future alarms, without replaying missed runs; this is not guaranteed to fire on every OS suspend/resume.

## Performance foundations

- `aster_startup_probe.py` launches only a disposable-profile browser process and measures readiness of an isolated loopback DevTools endpoint, without disabling Chromium's sandbox.
- `aster_perf_compare.py` compares numeric data from the existing CPU/RSS sampler or startup probe without making automatic PASS claims.
- BrowserQuickControls also measures the Chrome tab-activation API acknowledgment duration. This is **not** first paint, perceived tab switching or input-jank proof.
- No CPU/RAM/startup/battery improvement is claimed. F01/F02/F03/F04/F05 remain PARTIAL until matched running measurements.

## Two not yet source-implemented features

- **R02: Heartbeat continues the same existing task.** Scheduled tasks currently execute new work, with active-run metadata and an alarm system. A safe continuation requires durable original task identity, tool/approval state, non-replaying restart rules and explicit user authorization.
- **P03: Origin-safe blind autofill.** Chromium's native password manager must own the secret and enforce the requesting origin. There is no supported verified native bridge here; a fake API or prompt-based password fill would expose credentials and violate the requirement.

## Critical work left open

The actual linked native Aster binary has still not been built in this environment. Native HTTPS browsing, Wayland/X11 fallback, extension READY, product identity, sandbox, password-manager trust boundary, per-tab isolation, crash/restart recovery, file/download lifetime, outbound-data review, model routing, agent concurrency, permissions, site recipes and local CLI all need source review and runtime tests on a suitable Linux host.

Maintain signed-release requirements, custody of keys and owned update feeds as blocked. Continue implementing the **95 original subtasks**, not just editing the 72-row status table. No release-ready claim is supported by this checkpoint.
