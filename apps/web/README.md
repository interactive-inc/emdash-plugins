# web — EmDash Pluginsのサンプル

`@interactive-inc/emdash-plugins/builder`を使い、チャットからページとコンテンツを作り、プレビューして公開するサイトです。
Astro + EmDash + React + json-renderで動作します。EmDash本体は変更していません。

## ローカルで動かす

この説明のコマンドはモノレポのルートで実行します。開発には`.node-version`で指定したNode.js 24.22.1とVite+（vp）、Portlessを使います。

```sh
vp install
vp run setup:local
vp run seed
portless
```

- 公開サイト: https://emdash-plugins.localhost/
- 管理画面: https://emdash-plugins.localhost/_emdash/admin
- MCP: https://emdash-plugins.localhost/_emdash/api/mcp

`setup:local`は`apps/web/.data/`と、未設定の場合にランダムなプレビュー署名キーを`apps/web/.env`に用意します。
`seed`はサンプルのホームとガイドを作ります。ホームはKV・特徴カード・CTAに入場アニメーションを付け、ガイドはスクリプトなしの静的ページです。同じslugの既存ページは上書きしません。
Portlessから起動すると、AstroはPortlessの子プロセスとして動きます。停止は`vp run dev:stop`、状態は`vp run dev:status`で確認できます。
依存パッケージ・Astro設定・環境変数・プラグインのビルドを変更する前に、このアプリを完全に停止してください。変更後に`portless`で起動し直します。EmDash 1.3.1では内部再起動前のランタイムが残り、保存時に`Vite module runner has been closed`となる場合があります。DBやセッションを削除する必要はありません。

管理画面ではEmDash標準のパスキー認証を使います。初回はセットアップ画面で所有者を作成してください。
ローカルの動作確認ではEmDash公式の開発専用ログインを利用できます。
`/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` は開発モード限定で、開発用ユーザーを作成します。本番ビルドでは拒否されます。

## チャットから操作する

MCPクライアントに上記接続先を登録し、EmDashのOAuth認可を行います。外部サービスからローカルURLには接続できないため、その場合は公開環境のHTTPS URLが必要です。
EmDash管理画面のPluginsでBuilderのMCPツールを有効にします。プラグインのツール用に`mcp:tools:builder`、コンテンツ用に必要な`content:read` / `content:write`などを許可します。ユーザーロールの権限も別途適用されます。

1. `builder__catalog`: 使用できる部品とJSON仕様を読む。
2. `builder__validate`: ページJSONを検証する。
3. `content_create`: `collection: "pages"`に下書きを作る。
4. `builder__preview`: 保存したページIDからプレビューURLを発行する。
5. `content_get`で最新の`_rev`を取得し、`content_publish`で公開する。
6. 変更時も`content_get` → `content_update` → プレビュー → `content_publish`の順で操作する。

`tools/list`で実際のツール名・入力仕様を確認してください。スキーマを変更する操作は管理者のみが行えます。
管理画面には別のチャットやモデルを組み込んでいません。接続したMCPクライアントが生成を担当します。

### ページの保存例

EmDashの標準フィールドとして`slug: "home"`を指定するとホームになります。それ以外は`/{slug}`です。
`home`は`/home`でも表示できます。`preview`と`_emdash`以下はシステム用です。

```json
{
  "collection": "pages",
  "slug": "example",
  "data": {
    "title": "新しいページ",
    "description": "ページの紹介",
    "document": {
      "version": 1,
      "spec": {
        "root": "section",
        "elements": {
          "section": { "type": "Section", "props": {}, "children": ["container"] },
          "container": { "type": "Container", "props": {}, "children": ["title"] },
          "title": { "type": "Heading", "props": { "text": { "$state": "/page/title" }, "level": "h1" } }
        }
      },
      "theme": { "accent": "#d4ff5a", "font": "sans", "radius": "lg" }
    }
  }
}
```

`document.data`には名前付きEmDashクエリを置けます。

```json
{
  "posts": { "collection": "posts", "limit": 6 },
  "article": { "collection": "posts", "id": "article-id-or-slug" }
}
```

表示部品では`{"$state":"/data/article/title"}`などで参照します。
一覧はコンテナに`"repeat":{"statePath":"/data/posts","key":"id"}`を付け、子のプロパティで`{"$item":"title"}`を使います。`repeat`には`id`のない一覧クエリだけを指定できます。
リンクの`{"$template":"/articles/${slug}"}`なども使えます。URLに対応するページやルートは別途用意してください。
要素の`props`に`"motion":{"effect":"fade-up"}`を加えると、画面に入ったときに1回だけ入場アニメーションを再生します。一覧はStack・Gridに`"motion":{"effect":"fade-up","stagger":"medium"}`を付けると、子が順に表示されます。使える値と制約は`builder__catalog`と[パッケージのREADME](../../packages/emdash-plugins/README.md#モーション)を参照してください。
記事本文は`PortableText`部品へ`value`として渡します。標準テキスト・リンク・画像を描画します。EmDash固有の埋め込みやプラグイン独自ブロックには、対応するReact部品の追加が必要です。メディアはEmDashでアップロードし、返されたメディアURLを`Image.src`に指定します。

## プレビューと公開

- 公開ページとプレビューは同じAstro + Reactレンダラーを使います。
- Pagesでページを開くと、保存済み下書きの大きなプレビューを自動表示します。内容を確認してEmDash標準の公開ボタンで公開します。
- Page JSON・タイトル・説明の手動入力欄は、標準のフィールドwidgetで置き換えています。作成・変更はチャットから行い、保存した下書きはプレビュー枠に自動で表示されます。公開状態・履歴・権限はEmDashが管理します。
- EmDash標準のView on siteも同じページを表示します。
- 独自プレビューURLは15分有効で、対象の1ページだけを許可します。
- ページから参照する別記事は公開状態に従います。ページのトークンで別記事の下書きは読めません。
- プレビューは`private, no-store`と`noindex, nofollow`を返します。管理画面内のiframeはスクリプトを許可しないため、モーションのあるページも完成状態で表示します。アニメーションは公開ページとプレビューURLで確認します。
- 登録済み部品・プロパティ・テーマだけを受け付けます。JavaScript、任意CSS、HTML注入、外部データ取得先や未登録アクションはJSONに追加できません。

## 確認

```sh
vp run check
vp run test
vp run build
# portlessが起動している状態で実行
vp run smoke
```

`smoke`はローカル開発専用です。開発用ユーザーでMCPとAPIを操作し、テスト用コンテンツを作成・公開・更新して、最後にTrashへ移します。専用の一時トークンは失効させます。
公開前の内容の隔離、署名改ざん、別ページへのトークン流用、記事のデータバインディング、MCPからの作成・公開を確認します。

## 本番実行と更新

```sh
vp run build
HOST=127.0.0.1 PORT=4332 vp run start
```

Cloudflareでは`astro.config.cloudflare.mjs`と、Git管理外の`wrangler.production.jsonc`を使用します。公開している`wrangler.jsonc`のID・ドメインは設定例です。
[Cloudflareの設定手順](../../.docs/deployment.md)に従ってリソースとSecretsを用意し、`vp run deploy:production`を実行してください。

ローカル状態は`.data/`と`.env`、本番状態はD1・R2・KVに保存します。本番では開発コマンドや開発専用ログインを使用しません。

EmDashの更新は公式の`upgrade-emdash`で依存を更新し、生成された`.emdash/UPGRADE.md`の指示に従います。
DB変更を含む更新は、更新したアプリの起動前に復旧可能なバックアップを用意します。
独自プラグインはモノレポの`packages/emdash-plugins/`にあり、更新時は上記の検査とMCPの動作確認を行います。

[EmDash公式ドキュメント](https://docs.emdashcms.com/) · [json-render](https://json-render.dev/docs)
