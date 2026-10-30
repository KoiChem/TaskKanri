# UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 合意した4点を実装・検証しGitHub Pagesへ公開する。
**Architecture:** 日別予定と共有契約は維持。候補を端末の補助情報として追加し、既存の入出力と正規化で保持する。開始カードのログインは既存のcontroller.loginを使う。
**Tech Stack:** JavaScript modules, CSS, Node test runner, Playwright MCP, GitHub Pages.
**Spec:** docs/superpowers/specs/2026-10-30-ui-refresh-design.md

## Global Constraints
- 通常メモから候補を拾わない。候補ボタン形式、登録済み時数条件、自由追加を保持。
- ボタン間8px以上、開始操作44px以上。タスク枠の高さ調整と手動同期を維持。
- データ削除・実アカウントの変更を検証に使わない。

## Review Focus
- 候補記録は実行失敗・キャンセル・プレビューだけでは永続化されない。
- 旧バックアップに候補がなくても登録条件やメモは失わない。
- クラウド受信とモバイル編集はローカル候補を消さない。
- 狭い幅と横配置パネルでもボタンが接触せず操作できる。
- ログイン失敗と往復でパスワード・フォーカス・表示が適切に戻る。

### Task 1: 候補の保存と候補元
Files: taskkanri-core.mjs, taskkanri-timetable.mjs, taskkanri-import.mjs, taskkanri-app.js, tests/timetable.test.mjs.
- [x] RED: 成功した授業時限からの先頭語だけを保存、通常メモ・非授業枠・除外枠を除外、重複除去、入力不変、バックアップ往復・選択インポート・同期受信後保持をテスト。
- [x] GREEN: timetableWordsを任意の正規化済み文字列配列として追加し、一括計画の変更対象だけから候補を蓄積。renderCountTagsは保存済み候補のみ使用。
- [x] Focused tests: node --test tests/timetable.test.mjs.

### Task 2: UIと開始ログイン
Files: taskkanri-app.js, index.html, settings-ui.css, sync-ui.css, taskkanri-sync-ui.js.
- [x] 開始画面、管理ボタン、表色、共通ラベルを修正。
- [x] Playwrightで開始選択・フォーム往復・模擬ログイン失敗、オフライン再起動、ボタン導線、候補永続化、色と間隔、428px幅を確認。

### Task 3: 検証・レビュー・公開
- [x] 全Nodeテスト・build・git diff --check。追加変更がない限り反復しない。
- [x] 独立レビューを受け、重要な指摘を修正し影響箇所を検証。
- [x] キャッシュ識別子更新、mainへ統合、commit/push、当該commitのActions成功、公開URLの変更資産とUIを確認。

## Verification record
- 124 Node tests passed; build and git diff --check passed.
- Playwright: startup geometry, inline failed login and mocked successful login, password clearing/focus, offline restart with no cloud requests, candidate preview/execute/reload/selection, button gaps at 1366/900/428px, timetable backgrounds, export download and selective import passed.
- Existing manual-sync and task-height flows passed, including IME, duplicate-send protection, pending/conflict preservation, date jumps, drag, keyboard and reload.
- Fresh independent review: no Critical/Important findings.
- Browser verification found and fixed inherited toolbar visibility behind start card and stale condition-input text after selecting a candidate. Both were reproduced before fixes and passed afterward.
- Candidate history is local auxiliary state; file transfers carry it, cloud merge preserves local history without changing the shared DB contract.
- Publication: complete the authorized main push and then verify the same commit deployment and public assets.
