# Task Panels Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
**Goal:** 独立授業タスクと二列ToDoを保存・同期を保護して公開する。
**Architecture:** lessonTaskDataを独立共有HTMLに追加。schema9/contract3で旧版保存を拒否する。PCの一覧は表示セッション内で完了行を保持する。
**Tech Stack:** JavaScript modules, CSS, Supabase PostgreSQL, Node test, Playwright, GitHub Pages.
**Spec:** docs/superpowers/specs/2026-11-13-task-panels-design.md
## Global Constraints
- 既存作業ツリーと利用者データを保持。ボタンを接触させない。
- 授業は独立保存、PCに左右の見出しを表示しない。
- ToDoの済は共通切替まで同じ位置に保持。
## Review Focus
- schema8インポート・未送信キュー・キャッシュ移行で授業を失わない。
- 別枠の同期統合と同じ枠の競合保護。
- 同名タスクや完了行の後ろの状態変更を誤参照しない。
- リサイズと再描画で列順と済行を維持。
- iPhone 13 Pro Maxのボタン間隔と同期メニュー。
## Task 1: Data contract
Files: taskkanri-core.mjs, taskkanri-sync-model.mjs, taskkanri-sync-engine.mjs, taskkanri-import.mjs, taskkanri-received-changes.mjs, mobile-editor-model.mjs, supabase/migrations/, tests/.
- [x] Add failing schema9/legacy8/lesson edit/merge/import/SQL tests.
- [x] Implement independent lessonTaskData with old client write protection.
- [x] Run Node model/database tests.
## Task 2: PC panels
Files: taskkanri-app.js, settings-ui.css, tests/browser-task-panels.mjs.
- [x] Add browser test for independent saved editors, column fill, cycling and deferred completed removal.
- [x] Implement split editors, safe badge refs, source-aware commit and stable listing.
- [x] Verify via Playwright local browser.
## Task 3: Mobile
Files: mobile-app.js, mobile-editor.js, mobile.html, mobile.css, tests/.
- [x] Add lesson save/detail/status/conflict tests.
- [x] Add lesson tab/editor and upper sync row with separated touch targets.
- [x] Verify mobile browser layout and persistence.
## Task 4: Release
- [x] Run all Node tests, build, diff check; review final changes.
- [x] Apply additive RPC migration before publishing frontend; verify old writes rejected.
- [ ] Fetch/reconcile origin, commit and push authorized release; check CI/Pages.
- [ ] Verify deployed browser flows and served version. Report native-device gap.
