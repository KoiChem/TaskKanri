# TaskKanri / TaskKari Supabaseセットアップ

2026-10-12。アプリ名はTaskKanri、作成済みSupabaseプロジェクト名はTaskKari。

## 1. DB

SQL Editorで `supabase/migrations/202610120001_taskkanri_sync.sql` を実行する。新しい3テーブルに限定した初期設定。既存テーブルがある場合、再実行せず先に適用履歴を確認する。

RLSを無効にしない。認証ユーザーにも直接更新権限を与えず、専用RPCでrevision比較・mutation重複検出・本人確認を行う。

### 日付別予定への更新（2026-10-14）

初期設定済みのDBでは `supabase/migrations/202610140001_day_schedules.sql` を先に実行し、その後PC・モバイルを公開する。初期migrationを再実行しない。追加migrationはRPCを置換し、`taskkanri_documents.legacy_payload` を追加するだけで、認証・RLS・権限・既存の文書は変更しない。

旧contract 1/schema 7と新contract 2/schema 8を検証する。最新revisionによる新形式の保存が成功した時だけ、直前の旧payload全体を `legacy_payload` に一度保存する。変換後の旧形式保存は `app_update_required` で拒否する。原本は本人の既存RLS範囲で復旧できる。新形式で初めて作成した文書には旧原本はない。

適用確認は個人の本文やUUIDを出さない次のSQLで行う。

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'taskkanri_documents'
  and column_name = 'legacy_payload';
select payload->>'appSchemaVersion' as schema_version, count(*) as documents,
  count(legacy_payload) as preserved_originals
from public.taskkanri_documents group by 1;
select p.proname, p.prosecdef, p.proconfig, p.proacl,
  position('app_update_required' in pg_get_functiondef(p.oid)) > 0 as rejects_downgrade
from pg_proc p where p.oid = 'public.save_taskkanri_document(bigint,uuid,jsonb)'::regprocedure;
select relname, relrowsecurity from pg_class
where oid in ('public.taskkanri_documents'::regclass,
  'public.taskkanri_allowed_users'::regclass, 'public.taskkanri_mutations'::regclass);
```

公開を戻す場合もschema 8を読める版を使用する。旧形式への書込みを再開したり原本列を削除したりしない。

## 2. 本人専用アカウント

Authentication → Users → Add user → Create new user。
本人がアプリ用のメールアドレスとパスワードを入力し、当該ユーザーのみAuto Confirm Userを選んで作成する。Supabase管理アカウントとは別のユーザー。パスワードをGitやチャットへ記録しない。

作成したUUIDを確認し、SQL Editorで以下を実行する。UUID以外の秘密は不要。

```sql
insert into public.taskkanri_allowed_users(user_id)
values ('ここをAuthユーザーUUIDへ置換'::uuid)
on conflict do nothing;
```

AuthenticationのSign In / Providers設定で新規ユーザー登録（Allow new users to sign up）を無効にし、メール＋パスワードを有効にする。Site URLはPC版のGitHub Pages URLに設定する。本MVPのパスワードログインではメール送信・OAuthの戻り先は使用しない。

## 3. 接続と最初の登録

`supabase-config.js` には利用者から受け取ったProject URLとPublishable keyを設定済み。この2値は公開情報。Secret/service_roleキー・DBパスワードをアプリに入れない。

PC版の「同期設定」でログインする。クラウド未作成時のみ、年度・日別例外等の概要が表示される。
「データを書き出す」で現在のPCデータをバックアップし、「このデータで同期を開始」を選ぶ。初期登録成功後、モバイルでも同じアカウントでログインする。

既にクラウドにデータがある端末はそれを取得する。スマホの空データで初期化しない。

## 4. 競合・復旧

「変更が競合しています」の場合、同期設定で「未送信データを書き出す」を実行して保全し、「最新データを読み込む」で最新を確認する。未送信書き出しファイルは診断・手動復旧用で、通常バックアップと異なり直接インポートしない。

正常データのバックアップにはPC版の既存エクスポートを使う。全体インポートは他端末にも反映されるため、先にバックアップを取り、確認画面の概要を見る。

Freeプロジェクトが停止した場合はSupabase Dashboardで再開。アプリは障害を空データとして保存しない。スマホは最後の正常取得内容を表示でき、未確定保存がある間は追加編集を止める。

パスワード変更が必要な場合は本人がSupabaseのユーザー管理手順で変更し、アプリで再ログインする。本MVPに公開パスワード再設定フォームはない。

同期モードの端末初期化はクラウドを削除しない。アカウントのログアウトでは画面をクリアし、未送信版は本人・タブごとの端末領域に保全する。

## 5. 開発・検証

Node 24、pnpm 11.19.0。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm preview
```

`http://127.0.0.1:4173/index.html` と `/mobile.html`。モバイル検証は428×926および428×740。実iPhoneのSafari検証はエミュレーションと別に必要。

DBテストはPGliteの独立したPostgres環境でRLS・権限・CAS・重複処理を実行する。利用者のプロジェクトへテスト用予定を混入しない。

公開資産はdistだけ。SQL・テスト・仕様書・node_modules・私的バックアップをGitHub Pagesへ配布しない。今回の承認範囲にはフロント公開と追加DB migrationの適用を含む。

サービスワーカーはMVPでは導入していない。開いている画面でのオフライン閲覧は対応するが、オフラインの初回起動は保証しない。
