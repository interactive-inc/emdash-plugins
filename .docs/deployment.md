# Cloudflareへのデプロイ

## 設定

1. `apps/web/wrangler.jsonc`を`apps/web/wrangler.production.jsonc`へコピーする。後者はGit管理外。
2. 自分のWorker名、カスタムドメインの`routes`、`EMDASH_SITE_URL`、D1のdatabase_name/database_id、R2のbucket_name、SESSION用KVのidを設定する。公開設定のゼロのIDと`cms.example.com`はプレースホルダー。
3. WranglerでCloudflareへログインし、対象アカウントとリソースを確認する。必要なら非公開設定にaccount_idを指定する。
4. `EMDASH_PREVIEW_SECRET`と`EMDASH_ENCRYPTION_KEY`を、対象WorkerのSecretsへ登録する。値をソースやログへ書かない。
5. 初回はEmDash公式の手順で新規DBのスキーマ・初期セットアップを準備する。再デプロイ時には初期化やseedを繰り返さない。開発用アカウント・パスキー・ローカル署名キーを本番へコピーしない。

## 更新

開発アプリを完全に停止してから実行する。

```sh
vp run check
vp run test
vp run build
vp run deploy:production
```

`deploy:production`は非公開設定があることを先に確認し、その設定でCloudflare用にビルド・デプロイする。出力は`apps/web/dist-cloudflare`。Node用ビルドとは分離される。
`vp run build:cloudflare`だけを実行すると公開の設定例でビルドする。これはデプロイしない。
Cloudflare用ビルドではローカル`.env`を読み込まない。プレビュー用・暗号化用のキーは実行時のWorker Secretsで提供する。

ブラウザーセッションはKV、記事はD1、メディアはR2へ保存する。予約公開・メンテナンスは公式scheduled handlerと毎分のCron Triggerを使う。

デプロイ後は公開ページ・下書きの匿名404・管理画面の標準ログイン・匿名MCPの401・開発ログインの403・署名付きプレビューを確認する。管理者のパスキーは本番ドメインで登録する。
EmDashのDB変更を含む更新では、migrationの対象を確認し、復旧できるバックアップを準備する。

[EmDash Cloudflareデプロイ](https://docs.emdashcms.com/deployment/cloudflare/) · [Secrets](https://docs.emdashcms.com/deployment/secrets/)
