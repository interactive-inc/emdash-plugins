# 設計と開発

## 構成

- Astro + EmDash + React + json-render。EmDash本体はnpm依存として使い、ネイティブプラグインで拡張する。
- `packages/emdash-plugins`が検証・部品・MCP拡張・描画・CSS・プレビューを提供し、`apps/web`が利用する。
- 既定の`pages.document`はバージョン付きJSON。保存先・公開URL・プレビューURL・トップページslugは設定可能。独自部品はホストのコードで登録し、MCP・検証・描画で共用する。保存前と描画前に共通カタログで検証する。
- GUIではdocumentの入力欄をプレビューへ置換し、チャット管理のタイトル・説明欄を隠す。公開・履歴・認証はEmDash標準。
- MCPは登録済み部品を組み合わせる。任意のJavaScript・CSS・HTML・fetch先は受け付けない。部品の追加にはコード変更が必要。
- プレビューと公開ページは同じレンダラーを使う。署名は1ページだけを許可し、参照記事の下書きへ権限を広げない。
- ローカルはSQLite・ローカルメディア。本番用に公式Cloudflareアダプター（Workers・D1・R2・KV）を用意する。

## 開発

[起動・検査](../README.md) · [MCPとページの操作](../apps/web/README.md) · [パッケージAPI](../packages/emdash-plugins/README.md) · [デプロイ](deployment.md)

- コマンドはVite+（vp）を使う。PortlessのURLは`https://emdash-plugins.localhost`。
- 依存・設定・環境・プラグインのビルドを変える前に開発アプリを停止し、変更後に完全に起動し直す。EmDash 1.3.1は内部再起動後に古いVite runnerを参照する場合がある。
- `vp run check`、`vp run test`、`vp run build`で型・ユニット・SSR・ビルドを検査する。
- `vp run test:package`は一時フォルダーの独立ホストでインストール・MCP・公開/下書き・プレビューを検査する。配布ファイルはリポジトリへ残さない。
- `vp run smoke`は起動中のローカルアプリ専用。公式開発ログインを使うため本番へ実行しない。
- ライセンスはMIT。npmには未公開。
