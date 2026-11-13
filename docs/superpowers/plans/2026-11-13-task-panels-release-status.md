# 実装・検証・公開引き継ぎ
作業コピー: `/private/tmp/taskkanri-lesson-release`
ブランチ: `feat/lesson-task-panels`
元のユーザー作業ツリーは変更せず、公開済み76240e0を基準に実装。

## 完了
- 共通/授業の独立保存とPC二列枠、ToDoの左列→右列の順序。
- 状態を即時保存し、済を共通切替まで保持。同期受信で再描画されても保持。
- モバイル予定/共通/授業/未完、同期上段。428x926で各44px/間隔5px。
- schema9/contract3、旧schema8移行、書出/取込/差分/下書き/競合/未送信復旧。
- 追加DB migration作成・PGlite実行検証（旧版の降格保存拒否、CAS、反復適用、文書・権限保持）。
- 全163 Nodeテスト成功、ビルド・diff check成功。
- Playwright: 新規PC二列/状態/完了保持・タブ切替・保存再読込、同期受信後の済保持、既存高さ変更、新規授業モバイル独立編集/下書き/状態取消/競合/再更新保護が成功。既存モバイル編集・保存競合も成功。pageErrorsなし。
- 別エージェントレビューの2指摘（同期時の完了保持リセット、形式不備バッジを含むDOM誤参照）を失敗テストで再現後に修正し成功確認。

## 本番DB更新
2026-11-13、Supabase管理画面で対象プロジェクト`fethojoncgermqwzrwtw`に追加migrationを適用済み。実行成功（返却行なし）。独立した関数定義確認で`lesson_ready=true`、`lesson_validated=true`、`downgrade_protected=true`、`security_definer=true`、空の`search_path`を確認。既存利用者文書へ書き込みは行っていない。

## 公開
DB更新後、最新mainが基準の76240e0と一致することをGitHub MCPとgit fetchで確認。承認済みの変更をmainへ統合してGitHub Actionsから公開する。公開完了とライブ確認の結果は実行報告に記載する。

## 検証範囲
公開ブラウザ検証は隔離したテスト用データ・API応答で実施し、利用者の本番文書を変更しない。実機iPhoneの検証は未実施。
