# TaskKanri PC・モバイル改善 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; independent file scopes may use superpowers:dispatching-parallel-agents. Do not pause for previously granted implementation/publication approval.

**Goal:** Preserve existing schedules while removing recurrence, adding explicit period append/replace, and simplifying settings and sync UI.

**Architecture:** Canonical schema 8 uses dateSchedules; schema 1–7 imports expand resolved schedules before removing rules. Contract 2 is deployed through a backwards-compatible RPC update that prevents downgrade after conversion. Existing storage snapshots, CAS and session history protect all writes.

**Tech Stack:** Existing ES modules, HTML/CSS, Node test runner, PGlite, Supabase RPC, GitHub Pages, Playwright MCP.

**Spec:** ../specs/2026-10-14-pc-mobile-ux-design.md

## Global Constraints

- Keep 「チャイム時刻」「縦画面／横画面」; explanations remain short.
- Sync HH:mm is a successful operation's actual Japan time, never example text or document update time.
- Append preserves existing rich text and badges. Replace requires a fresh choice for empty cells.
- No data loss, half-save, recurrence, master persistence, hidden-slot deletion, or cross-user access.
- Main user authorization includes implementation, push and publication. Work in a feature branch in the existing writable checkout; existing untracked spec is preserved.

## Review Focus

- Old cloud cache and pending requests must not restore rules or drop user edits during migration.
- Cached reads and failed sync cannot advance the success timestamp.
- Settings validation errors must keep every draft; global save must be atomic.
- Preview invalidation must cover remote update and date visibility changes.
- Year switch must preserve already entered next-year events, hidden slots and other-year records.

## Task 1: Canonical day schedules and period operations

**Files:** taskkanri-core.mjs, taskkanri-timetable.mjs, tests/core.test.mjs, tests/timetable.test.mjs.
**Interfaces:** migrateToCurrent(data, version), getResolvedSlot(date, slot, state), planTimetableInput(state, {start,end,table,mode,emptyMode}) -> {ok,value:{state,changes,excluded}}, normalizeState(state), serializePayload(state).

- [ ] Add failing tests for append, replace empty choices, exclusion, exact boundaries, rich badges and legacy rule/override migration.
- [ ] Run focused tests and observe failure.
- [ ] Implement canonical schema 8, legacy conversion, day-only edits and non-mutating period planner.
- [ ] Adapt superseded legacy behavior tests to migration behavior; preserve safety and holiday tests.
- [ ] Run Node tests for the owning files and record results.

## Task 2: Cloud contract and synchronization

**Files:** taskkanri-sync-model.mjs, taskkanri-sync-engine.mjs, taskkanri-sync.js, new supabase/migrations/202610140001_day_schedules.sql, tests/sync-model.test.mjs, tests/sync-engine.test.mjs, tests/database.test.mjs.
**Interfaces:** toPayload(state) -> contract 2/schema 8 with 11 shared keys; mergePayload(payload, local) accepts old/new; RPC retains expected_revision and mutation_id signature.

- [ ] Write failing tests for new contract, old reads, downgrade rejection, old pending protection, duplicate RPC and real success timestamps.
- [ ] Verify failures before implementing model, engine and additive SQL migration.
- [ ] Run PGlite security/CAS/idempotence tests, keeping real project data out of tests.
- [ ] Apply tested RPC through authenticated Supabase dashboard and verify function metadata; migrate user documents only through app's backed-up CAS flow.

## Task 3: Desktop settings and one-time timetable UI

**Files:** index.html, taskkanri-app.js, settings-ui.css, taskkanri-settings.mjs, tests/settings.test.mjs, tests/browser-ux.mjs.
**Interfaces:** consumes dateSchedules and planTimetableInput above; saveSettings validates drafts as one transaction; table preview uses a state fingerprint and stale preview requires confirmation again.

- [ ] Add behavior tests for atomic settings validation, date/name parsing and year preservation.
- [ ] Implement sticky save/navigation, retained short labels, date/name rows and separate timetable view.
- [ ] Remove master/rule actions and destructive rollover wizard; retain holiday/slot configuration and history.
- [ ] Verify browser append/replace/both empty choices, stale preview, undo, invalid drafts and keyboard focus.

## Task 4: Mobile and synchronization UI

**Files:** mobile.css, mobile-ui.mjs, taskkanri-sync-ui.js, sync-ui.css, mobile-app.js, tests/mobile-ui.test.mjs.
**Interfaces:** common sync label uses engine.lastSuccessfulSyncAt; actual sync state flows through existing onStatus callback.

- [ ] Pin timestamp behavior with Node tests; reversible CSS is verified in browser.
- [ ] Widen mobile event row to all columns with safe-area-aware 8px padding; normal date color #6B6B6B; keep today, day fills and 44px touch targets.
- [ ] Make PC status a text button and preserve accessible modal/status handling; reorganize normal/recovery actions with succinct labels.
- [ ] Verify 428×926 and 428×740, PC 1280×900/1366×768, no overflow/errors, and restore focus.

## Task 5: Release

**Files:** scripts/build.mjs, build version fields, SUPABASE_SETUP.md, release record.

- [ ] Run full test suite, syntax checks, build, git diff --check and local browser flows.
- [ ] Conduct a fresh whole-change review and fix material defects with regression tests.
- [ ] Commit, integrate approved work into main, push, and wait for terminal GitHub Actions/Pages result.
- [ ] Check served version/assets and deployed PC/mobile flows with disposable API fixtures. Keep real Supabase/physical-device evidence distinct.
- [ ] Record final verification and any concrete limitations.
