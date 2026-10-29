# PC Manual Sync Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 合意したPC手動同期と共通タスクタブを公開する。
**Architecture:** SyncControllerのdesktop経路だけ自動処理を止め、既存の永続CASキューを使う。タブは表示状態のみ保持し既存抽出を共有する。
**Tech Stack:** JavaScript modules, Node test, Playwright, GitHub Pages.
**Spec:** docs/superpowers/specs/2026-10-29-desktop-manual-sync-design.md

## Global Constraints
モバイル自動同期と既存データを保持。reload等では自動取得しない。IME・未送信・競合を保護。

## Review Focus
- キャッシュなしreloadから手動取得できること。
- pendingの再読み込みは送信も上書きもしないこと。
- 同期ショートカットに編集中の最新本文が含まれること。
- 同期中の追加入力を完了済みと表示しないこと。
- 日付ジャンプと一覧スクロールが整合すること。

## Tasks
- [x] 起動条件とPC自動送信抑止の失敗テストを追加・確認しSyncControllerを修正。
- [x] 同期UIを上部へ移動し、保存前処理とショートカットを共通化。
- [x] 共通タスクとToDo一覧タブを実装、既存抽出とジャンプを共有。
- [x] 単体全件・build・専用browser fixture・モバイル回帰・表示確認。
- [x] cache識別子更新、diff check、commit/push、Actionsと公開配信確認。

## 検証記録
- 単体121件成功、buildとdiff check成功。
- browser-manual-sync.mjsでPCの起動条件、未送信保持、IME、二重実行、競合、タブ/スクロール/非表示枠ジャンプを確認。
- browser-mobile-editing.mjsでiPhone 13 Pro Max相当428x926、13送信、既存編集・競合・共通タスクを確認。実機操作は未確認。
- 旧browser-mvp.mjsは後発UIで撤去済みの「共通タスク 2」セレクタを待って停止。現行browser-mobile-editing.mjsで同範囲を確認。PC自動送信前提の旧browser-desktopは今回の専用fixtureに置換して検証。
