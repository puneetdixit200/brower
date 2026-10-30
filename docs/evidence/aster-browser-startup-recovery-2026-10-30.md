# Browser startup task-recovery evidence — 2026-10-30

## Source behavior

`apps/app/entrypoints/background/index.ts` registers a `chrome.runtime.onStartup` listener. `browser-startup-recovery.ts` reads `executionHistoryByConversation`, marks only still-running tasks whose persisted `startedAt` predates the event timestamp, re-reads state before writing, and stores one marker per task under `executionHistoryBrowserStartup:<taskId>`. It skips malformed conversations/tasks, never rewrites canonical task history, and does not resume or replay execution. Server reconciliation continues to use `executionHistoryRecovery:<taskId>`; both Task History and Recent Tasks read both namespaces and prefer a matching server marker.

## Focused checks

Run from `packages/browseros-agent`:

```sh
bun test apps/app/lib/execution-history/browser-startup-recovery.test.ts apps/app/lib/execution-history/recovery.test.ts apps/app/screens/newtab/index/recent-tasks.test.ts
```

Result: 30 tests passed, 0 failed, 57 assertions. This includes malformed storage entries, terminal-state recheck, concurrent server-marker precedence, exact task/conversation matching, and existing server recovery behavior.

Run from `packages/browseros-agent/apps/app`:

```sh
bun run typecheck
```

Result: passed. Targeted Biome over the six changed app files and `git diff --check` also passed. Independent Luna review found the malformed-entry issue; it was fixed and covered by the test above. Follow-up review found no actionable issue.

The development extension bundle also built successfully with:

```sh
NODE_OPTIONS=--max-old-space-size=3072 bun run build:dev
```

WXT reported a 24.35 MB development bundle. It emitted existing unresolved-font-reference and Rollup annotation warnings; the build exited successfully.

## Runtime limit

A disposable direct Chromium launch with a seeded local running task did not produce an observable startup marker. The smoke is inconclusive; it does not establish that the extension startup event fired or that the UI displayed the marker. No Aster-native binary, headed Task History result, execution resumption, transcript replay, or tool replay is claimed. A05 remains PARTIAL.
