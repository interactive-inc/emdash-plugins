# @interactive-inc/emdash-plugins

Interactive Inc.のEmDashプラグイン集です。1つのパッケージを追加し、プラグインごとのサブパスから読み込みます。

```sh
vp add @interactive-inc/emdash-plugins
```

| サブパス | 内容 |
| --- | --- |
| `@interactive-inc/emdash-plugins/builder` | チャットで作るjson-renderページビルダー |

## builder

EmDashの認証・コンテンツ管理・公開管理を使い、MCPからjson-renderのページを作るネイティブプラグインです。
公開ページと管理画面内のプレビューを、同じAstro + Reactの描画処理で表示します。

### 導入

対応対象はAstro 7.4.2以降の7系、EmDash 1.3.1以降の1系、React/React DOM 19.2.4以降の19系です。検証済みの組み合わせはAstro 7.4.2 + EmDash 1.3.1です。
既存ホストに`@astrojs/react`の登録とEmDashのlive collection設定が必要です。

EmDash 1.3.1とCloudflareツールは、脆弱性修正前のZod・undiciを間接依存として固定しています。ホスト側でZod 4.6.7以降・undici 7.30.1以降へのoverridesを設定してください。パッケージのインストールだけではホスト側の間接依存は置き換わりません。

```js
// astro.config.mjs — 既存のadapter、database、storage設定を維持する
import { builderPlugin } from '@interactive-inc/emdash-plugins/builder';
import { builderIntegration } from '@interactive-inc/emdash-plugins/builder/astro';

// integrationsにbuilderIntegration()を追加
// emdash({ ...既存設定, plugins: [...既存プラグイン, builderPlugin()] })
```

`builderIntegration()`は`/[...slug]`と`/preview/[id]`を登録し、描画・CSS・プレビュー・レスポンス保護を提供します。
ルート全体をこのビルダーで表示したい場合に明示的に追加します。既存のcatch-allルートがあるサイトでは両方を登録せず、公開ページの所有範囲を先に決めてください。
ホストが設定したCSPなどのレスポンスヘッダーは上書きしません。

既定では`pages`コレクションの`document`フィールドを使います（保存先は後述の設定で変更できます）。
対象コレクションが通常の記事ページとして使われている場合、そのまま有効化しないでください。保存・公開にページJSONの検証が適用されます。
自動で既存スキーマやコンテンツを書き換える処理はありません。

初期構成に必要なフィールド:

- `title`: string、必須
- `description`: text
- `document`: json、必須、widget: `builder:page-preview`
- supports: `drafts`, `revisions`, `preview`。URL pattern: `/{slug}`

`slug: "home"`がトップページです。ほかは`/{slug}`になります。
これらのフィールドはEmDashの管理画面または標準MCPのスキーマ操作で用意できます。既存DBへサンプルコンテンツを一括投入する必要はありません。

`document.widget`に`builder:page-preview`を指定すると、EmDash標準のフィールド拡張でJSON入力欄を大きなプレビューに置き換えます。`title`と`description`には`builder:managed`を指定し、チャットで管理する値を通常画面の入力欄から隠せます。保存データ・検証・APIからの更新は維持されます。既存サイトでは標準のフィールド更新APIでwidgetだけを設定してください。
ページを開くと保存済み下書きをプレビュー枠だけで表示し、保存内容が変わると自動で読み込み直します。プレビュー枠はページの高さに合わせて伸びます。公開はEmDash標準の公開ボタンを使います。
管理画面の部品はReactとブラウザー標準APIだけで動き、EmDash内部のライブラリーやホストの別名設定に依存しません。

### 認証とプレビュー

- EmDash標準のユーザー・ロール・セッションとMCP OAuthを使用します。
- プロセスの環境変数`EMDASH_PREVIEW_SECRET`に安定した署名キーを設定してください。EmDash本体とプラグインで同じキーを使います。
- このキーは設定ファイルやブラウザーへ渡しません。ホスト固有の`astro:env`スキーマ宣言も不要です。
- ページ編集画面のプレビューは、保存済み下書きが対象です。JSONと内部メタデータを直接編集する欄は表示しません。
- 署名付きリンクは15分有効で対象の1ページだけを許可します。別記事の下書きへのアクセス権は付与しません。
- EmDash管理画面のPluginsで、BuilderのMCPツールを有効にしてください。MCPクライアントには必要な`content:*`と`mcp:tools:builder`のスコープを許可します。

### 公開エントリ

| import | 用途 |
| --- | --- |
| `@interactive-inc/emdash-plugins/builder` | `builderPlugin()`をEmDashのpluginsへ登録 |
| `@interactive-inc/emdash-plugins/builder/astro` | `builderIntegration()`で公開・プレビュールートを追加 |
| `@interactive-inc/emdash-plugins/builder/catalog` | 部品カタログ・JSON仕様・MCP向けガイド |
| `@interactive-inc/emdash-plugins/builder/extensions` | `defineComponent()`と独自部品向けの`safeUrl()` |
| `@interactive-inc/emdash-plugins/builder/document` | ページJSONの型・検証 |
| `@interactive-inc/emdash-plugins/builder/renderer` | `SiteRenderer`を独自ページから使用 |
| `@interactive-inc/emdash-plugins/builder/server` | `pageResponse()`で公開/下書きルールに従ってページを解決 |
| `@interactive-inc/emdash-plugins/builder/PageShell.astro` | 完全なHTMLページの標準表示 |
| `@interactive-inc/emdash-plugins/builder/styles.css` | 独自の表示で標準CSSだけを利用 |

`runtime`、`admin`、`middleware`も公開パスとして存在しますが、EmDash/Astroが読み込むための入口です。
サーバー用の入口はJavaScriptと型定義をビルドして配布し、React/Astro/CSSはホストのビルドで処理するソースとして配布します。
配布するソース内は相対importを維持し、ホスト固有の`@/`エイリアスには依存しません。

標準では12種類の部品を使用します。ホスト側で独自部品を登録し、保存先コレクション・公開URL・プレビューURLを変更できます。

### 保存先・URL・部品の拡張

`builderPlugin()`と`builderIntegration()`に同じ設定を渡します。省略時は保存先が`pages`、公開URLは`/`配下、トップページのslugは`home`、プレビューは`/preview`配下です。
設定変更前に開発アプリを停止し、変更後に起動し直してください。

```js
// astro.config.mjs
const builder = {
  collection: 'landing',
  basePath: '/site',
  previewPath: '/draft/view',
  homeSlug: 'index',
  componentsModule: './src/site-components.tsx',
};
// integrations: [react(), builderIntegration(builder), emdash({
//   ...既存設定, plugins: [builderPlugin(builder)]
// })]
```

この例では`landing`の`index`を`/site`に、他のslugを`/site/{slug}`に表示します。`landing`には上記と同じtitle・description・documentのフィールドとdrafts・revisions・previewを設定し、EmDashのURL patternも`/site/{slug}`に合わせます。既存コンテンツの自動移行はしません。管理画面のdocumentプレビューも設定したコレクションを対象にします。
パスにはローカルな固定セグメントだけを指定でき、外部URL、クエリー、相対移動、EmDashの管理用パスは使えません。既存ホストの同じURLを使うルートとの重複は避けてください。1ホストにつきBuilderは1設定です。

`componentsModule`はホストのAstroプロジェクトルートからのパスです。独自部品を使うホストには`zod`（このパッケージと同じ4系）を直接依存として追加します。

```tsx
// src/site-components.tsx
import { z } from 'zod';
import { defineComponent } from '@interactive-inc/emdash-plugins/builder/extensions';

export default {
  Notice: defineComponent({
    props: z.object({ text: z.string().max(2000) }),
    description: 'お知らせを表示する部品',
    component: ({ props }) => <aside className="notice">{props.text}</aside>,
  }),
};
```

登録したスキーマはMCPのカタログと保存時・公開時・データ解決後の検証に使われ、同じReact部品が公開とプレビューで描画されます。コンテナには`container: true`を指定し、`children`を描画します。既存の標準部品名の上書き、イベント・style・生HTML用プロパティは登録できません。未登録の部品や未知のプロパティも拒否します。
独自部品はホストが信頼するコードです。チャットからコードや部品定義を追加する機能ではありません。文字列をコードやHTMLとして実行せず、リンク・画像を扱う場合は同じ公開入口の`safeUrl`でURLを確認してください。部品のCSSはホスト側で読み込みます。

独自のルートを実装する場合は`pageResponse(identifier, builder, components)`と`<SiteRenderer document={page.document} state={page.state} components={components} />`で同じ設定・部品定義を渡します。単独で検証するときも`validateDocument(document, components)`を使用します。

### 権限と検証

プレビュー発行はEmDashの`content:read_drafts`権限に従います。匿名とSubscriberは拒否し、Contributor・Author・Editor・Adminは許可します。MCPでは加えて`mcp:tools:builder`スコープが必要です。管理画面は標準セッションを使います。EmDash 1.3.1のプラグインRESTルートをPATで直接呼ぶ場合は`admin`スコープも必要ですが、ロールによる権限チェックは引き続き適用されます。署名リンクは発行から15分有効で、コレクションと1ページに限定されます。

- `vp run test`: ロール別の発行可否・署名対象・15分の有効期間、独自部品の検証とSSR、設定とエディターの対象を確認します。
- `vp run smoke`: ローカルAPI/MCPで署名改ざん・期限切れ・別コレクション/ページへの流用・スコープ不足を確認します。`.env`または環境変数に、起動中のサーバーと同じ`EMDASH_PREVIEW_SECRET`が必要です。
- `vp run test:package`: 一時ホストに配布物をインストールし、実ユーザーのロール別HTTP権限、標準構成と独自部品・保存先・URLを変えた構成を開発/本番SSRで確認します。テスト用ユーザーとトークンは一時ホストのDBにだけ作成します。

## ライセンス

MIT
