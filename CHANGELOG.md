# CHANGELOG

`@interactive-inc/emdash-plugins`の利用者とこのリポジトリの開発者に意味のある変更だけを記録します。内部整理・テストだけの変更・依存の更新は書きません。

## 2026-11-16

### 修正

- builder（0.1.1）: `Response.redirect()`や`fetch()`の応答を返すルートで、セキュリティヘッダーを付けるmiddlewareが`TypeError: immutable`を投げ、500になっていた不具合を修正しました。EmDashのOAuth許可画面（`/_emdash/oauth/authorize`）が500で止まり、MCPクライアントが接続できませんでした。
