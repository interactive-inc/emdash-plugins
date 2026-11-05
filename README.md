# EmDash Plugins

Interactive Inc.のEmDashプラグイン集`@interactive-inc/emdash-plugins`のモノレポです。
EmDash本体は変更せず、ネイティブプラグインとして組み込みます。現在のプラグインは、チャットからjson-renderのページを作る`builder`です。

```text
packages/emdash-plugins/  配布パッケージ。プラグインごとにsrc/<name>/を持つ
apps/web/                 プラグインを利用するAstro + EmDashのサンプル
scripts/                  別プロジェクトへの導入検証・デプロイ
.docs/                    設計判断・デプロイ手順
```

## サンプルを動かす

開発には`.node-version`で指定したNode.js 24.22.1とVite+（vp）、Portlessを使います。リポジトリのルートで実行します。

```sh
vp install
vp run setup:local
vp run seed
portless
```

- サイト: https://emdash-plugins.localhost/
- 管理画面: https://emdash-plugins.localhost/_emdash/admin
- MCP: https://emdash-plugins.localhost/_emdash/api/mcp

`portless`は`portless.json`の設定でサンプルを起動します。起動時にプラグインもビルドします。`vp run dev`はプロキシを使わない直接起動です。
停止は`vp run dev:stop`、状態確認は`vp run dev:status`です。
プラグインのTypeScriptを変更した場合は、停止して`portless`で再起動してください。
依存パッケージ・Astro設定・環境変数を変更するときも、先にこのアプリを完全に停止し、変更後に起動し直してください。EmDash 1.3.1は内部再起動後に古いランタイムを保持する場合があり、保存時に`Vite module runner has been closed`が発生します。この場合はブラウザーの更新だけでは復旧せず、アプリのプロセス再起動が必要です。
ローカルDB・メディア・署名キーは`apps/web/.data/`と`apps/web/.env`に保存します。

[サンプルの操作・MCP接続手順](apps/web/README.md) · [プラグインの導入方法と公開API](packages/emdash-plugins/README.md)

## 検査

```sh
vp run check         # パッケージとサンプルの型検査
vp run test          # パッケージとサンプルのテスト
vp run build         # パッケージ → サンプルの順でビルド
vp run smoke         # 起動中のサンプルでMCP/API/下書き隔離を検査
vp run test:package  # 別フォルダーにtgzをインストールしてビルド・起動・MCP操作を検査
```

`test:package`は一時フォルダー内だけで導入用の圧縮ファイルと独立したEmDashホストを作成します。リポジトリに配布ファイルは残しません。インターネットから依存を取得する場合があります。
ルートは開発用のprivateワークスペースで、配布対象は`packages/emdash-plugins`だけです。
プラグインはMITライセンスで、`publishConfig.access: public`を設定しています。パッケージ名は`@interactive-inc/emdash-plugins`です。npmへの公開は`packages/emdash-plugins`で`vp pm publish`を実行する別の操作です。
`.env`、DB、セッション、サンプルのコンテンツは配布ファイルに含めません。

`vp run smoke`はMCPクライアントの登録なしで、実際のMCPへ接続してツール一覧・作成・公開・プレビューを確認します。Portless以外で直接起動した場合は`SMOKE_ORIGIN=http://127.0.0.1:4331 vp run smoke`を使います。

## 本番実行

```sh
vp run build
HOST=127.0.0.1 PORT=4332 vp run start
```

ローカルはNode.js + SQLite、本番はCloudflare Workers + D1 + R2 + KVです。Cloudflare設定には各自のリソースを指定します。

```sh
vp run deploy:production
```

先に[Cloudflareの設定手順](.docs/deployment.md)に従い、Git管理外の`apps/web/wrangler.production.jsonc`を用意してください。このコマンドはその設定でCloudflare用にビルドし、生成された設定でWorkerへ反映します。既存の本番DBをseedで上書きしません。Node用のビルドとは出力先を分けています。
ローカルの開発アプリは停止してから実行し、完了後に`portless`で起動し直してください。
本番のorigin・秘密情報・永続化については[サンプルの説明](apps/web/README.md#本番実行と更新)を参照してください。

## ライセンス

MIT License。詳細は[LICENSE](LICENSE)を参照してください。
