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
モーションのないページはJavaScriptを読み込みません。モーションを指定したページだけが、同じReactツリーをブラウザーでハイドレーションして入場アニメーションを再生します。

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

`builderIntegration()`は`/[...slug]`と`/preview/[id]`を登録し、描画・CSS・プレビュー・モーション用のclient directive・レスポンス保護を提供します。
ルート全体をこのビルダーで表示したい場合に明示的に追加します。既存のcatch-allルートがあるサイトでは両方のcatch-allを登録せず、後述の`basePath`で重ならないURLに置くか、公開ページの所有範囲を先に決めてください。
`builderPlugin()`だけでも保存時の検証・MCP・管理画面は動きます。`componentsModule`、`PageShell.astro`、モーションには`builderIntegration()`が必要です。
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
| `@interactive-inc/emdash-plugins/builder/astro` | `builderIntegration()`で公開・プレビュールートを追加し、`builderPlugin()`との設定の一致を検査 |
| `@interactive-inc/emdash-plugins/builder/catalog` | 部品カタログ・JSON仕様・MCP向けガイド |
| `@interactive-inc/emdash-plugins/builder/extensions` | `defineComponent()`と独自部品向けの`safeUrl()` |
| `@interactive-inc/emdash-plugins/builder/document` | ページJSONの型・検証 |
| `@interactive-inc/emdash-plugins/builder/renderer` | `SiteRenderer`を独自ページから使用（`page.view`またはdocument/stateを、モーションなしで静的に表示） |
| `@interactive-inc/emdash-plugins/builder/server` | `pageResponse()`で公開/下書きルールに従ってページを解決 |
| `@interactive-inc/emdash-plugins/builder/PageShell.astro` | 完全なHTMLページの標準表示（モーションを含む。部品は`componentsModule`から読み込む） |
| `@interactive-inc/emdash-plugins/builder/styles.css` | 独自の表示で標準CSSだけを利用 |

`runtime`、`admin`、`middleware`も公開パスとして存在しますが、EmDash/Astroが読み込むための入口です。
サーバー用の入口はJavaScriptと型定義をビルドして配布し、React/Astro/CSSはホストのビルドで処理するソースとして配布します。
配布するソース内は相対importを維持し、ホスト固有の`@/`エイリアスには依存しません。

標準では12種類の部品を使用します。PortableTextはEmDashのリッチテキストを表示し、リンクと画像は安全なURLのものだけを描画します。段落の中の画像はキャプションなしの`<img>`として表示し、1つの文字に複数のリンクが付いている場合は最初のリンクだけを表示します。見出し（h1〜h6）と引用以外の段落スタイルは、通常の段落として表示します。ホスト側で独自部品を登録し、保存先コレクション・公開URL・プレビューURLを変更できます。

### 保存先・URL・部品の拡張

`builderPlugin()`と`builderIntegration()`に同じ設定を渡します。両方を登録して設定が違うと、起動時にエラーになります。省略時は保存先が`pages`、公開URLは`/`配下、トップページのslugは`home`、プレビューは`/preview`配下です。
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
独自部品はホストが信頼するコードです。チャットからコードや部品定義を追加する機能ではありません。文字列をコードやHTMLとして実行せず、リンク・画像を扱う場合は同じ公開入口の`safeUrl`でURLを確認してください。部品のCSSはホスト側で読み込みます。ページ全体（`.site`）は`overflow: clip`のため、ページの端からはみ出す表示は切り取られます。

独自のルートを実装する場合は`pageResponse(identifier, builder, components)`でページを解決し、`builderIntegration()`と同じ設定・部品定義を渡します。
HTML全体を標準どおり出す場合は`<PageShell page={page} status={status} />`を使います。部品は`builderIntegration()`経由で`componentsModule`から読むため、`components`は渡しません。モーションも再生します。
既存のレイアウトへ埋め込む場合は`<SiteRenderer view={page.view} components={components} />`を使います。常にモーションなしの完成状態で描画し、スクリプトを出力しません。ホストが独自のstateで描画する場合だけ、`view`の代わりに`document`と`state`を渡します。この場合repeatはstateの一覧をすべて描画します。単独で検証するときも`validateDocument(document, components)`を使用します。

### モーション

要素の`props.motion`を指定すると、要素が初めて画面に入ったときに1回だけ入場アニメーションを再生します。MCPクライアントは`builder__catalog`の`motion`（使える値・対象部品・上限）と`guide`で仕様を確認できます。

```json
{ "type": "Heading", "props": { "text": "話すたび、サイトが育つ。", "level": "h1", "motion": { "effect": "fade-up", "duration": "slow" } } }
```

| 設定 | 値 |
| --- | --- |
| `effect`（必須） | `fade`、`fade-up`（24px下から）、`fade-down`（24px上から）、`fade-left`（32px右から）、`fade-right`（32px左から）、`zoom-in`（94%から） |
| `delay` | `none` 0秒（既定）、`short` 0.1秒、`medium` 0.2秒、`long` 0.4秒 |
| `duration` | `fast` 0.3秒、`normal` 0.5秒（既定）、`slow` 0.8秒 |
| `stagger`（Stack・Gridのみ） | `short` 0.05秒、`medium` 0.08秒、`long` 0.12秒 |

イージングは`cubic-bezier(0.22, 1, 0.36, 1)`で固定です。秒数・距離・イージング・CSS・スクリプトをJSONから指定する方法はありません。

- 対象はContainer・Stack・Grid・Heading・Text・Link・Image・Card・Badge・Divider・PortableTextと、`motion: true`で登録した独自部品です。Sectionは動かさず、中の要素に指定します。動く要素（staggerで動く子を含む）の中にもSectionは置けません。
- `src`が安全なURLでないImageは何も描画しないため、表示内容から外します。`alt`もモーションもブラウザーへ渡らず、ほかに動く要素がなければ、ページはスクリプトなしで表示します。
- Stack・Gridの`stagger`は、コンテナ自体を動かさず、直下の子（repeatで増えた項目を含む）を順に表示します。同時に画面へ入った子どうしが間隔ずつ遅れ、遅れは最大0.6秒です。子には`motion`を付けず、子も対象部品にします。
- 動く要素の内側には`motion`を指定できません。`motion`はリテラルのオブジェクトだけで、`$state`・`$item`などのバインディングは使えません。
- 動く要素は1ページ40個までです。staggerの子とrepeatで増える項目は1つずつ数え、repeatはデータの`limit`（未指定なら6件）だけ増えるものとして数えます。違反は保存時の検証で理由付きのエラーになります。

表示の仕組み:

- サーバーは動く要素を最終的な位置に透明（`opacity:0`）で出力し、画面に入ったときに開始状態から再生します。完成状態が一瞬見えてから隠れるちらつきはありません。最初の画面にある要素は読み込み直後に再生します。
- 画面に入ったかどうかは、要素が最終的に収まる位置が見えたかで、ブラウザー（IntersectionObserver）が判定します。はみ出しを切り取るコンテナ（`.site`や独自部品のカード・横スクロールの行など）で隠れている間や、閉じたアコーディオン・`<details>`の中にある間は再生せず、開いたりスクロールしたりして見えた時点で再生します。動くImage（と`Root`が`img`の独自部品）は読み込みとデコードが終わってから判定するため、空の枠で再生してから写真が現れることはありません。画像を包む動く要素（CardやContainerなど）は、画像の読み込みを待たずに再生します。高さや幅が0の要素（中身があふれて表示される独自部品の`Root`など）は、端に触れた時点で入ったとみなすため、閉じたアコーディオンの先頭では見えないまま再生を終えることがあります。
- 独自部品の横スクロールの行や、ボタンで送るスナップ付きのカルーセル（`overflow: hidden`と`scroll-snap-type`）など、要素をスクロールさせるコンテナの中では、移動も拡大縮小も省き、その場でフェードだけを再生します。再生中の変形で、コンテナのスクロール量やスクロールスナップの位置が変わらないようにするためです。フェードだけにするかどうかは再生を始めるときに決め、その後に画面幅が変わっても再生し直しません。
- マーキーのように祖先のアニメーションで運ばれて画面に入る要素や、スライドする窓から見えてくる要素も、見えた時点で再生します。Safariは描画の更新がないと画面に入ったことを判定しないため、待機中の要素がある間は250msごとに、祖先のアニメーションが再生中か、要素の位置が動いたかを確かめ、どちらかなら描画の更新を要求します。CSSアニメーション・一時停止からの再開・Web Animations API・独自部品のシャドウDOM（closedを含む）のどれで動いても同じです。スクロールに連動するアニメーション（`animation-timeline`）はスクロール中しか動かず、スクロール自体が描画を更新するため数えません。止まっているページでは描画の更新を要求しません。読み込み中のSafariは、監視を始めた要素の判定を描画の更新まで最大2秒ほど遅らせるため、監視を始めるたびに1回だけ描画の更新を要求します。
- ラッパー要素は追加しません。各部品の一番外側の要素が動くため、レイアウトはモーションなしと同じです。
- 再読み込み時のスクロール復元やアンカーで、すでに画面より上へ通り過ぎた要素は再生せずに表示します。スクロール位置は動かしません。`display:none`の中などボックスのない要素や、固定配置（`position: fixed`）の中の要素は通り過ぎた扱いにせず、表示されて画面に入ったときに再生します。closedのシャドウルートは中を外から見られないため、その中の固定配置やスクロールするコンテナは判定に入りません。
- JavaScript無効、`prefers-reduced-motion: reduce`、印刷、管理画面のプレビュー枠（スクリプトなし）では、完成状態の静的ページを表示します。読み込み時にreduced motionを設定している訪問者とIntersectionObserver非対応のブラウザーにはislandを読み込まず、そのページは静的なままです。途中で設定を戻しても再生せず、次の読み込みから再生します。
- 表示から1.5秒経ってもislandが要素を引き受けていない場合は、CSSで完成状態へ表示します（JavaScriptの遅延・失敗）。その後にハイドレーションした場合、画面内・画面より上・画面の下1画面分までの要素はそのまま表示し（CSSのフェード中なら最後まで続けます）、それより下の要素はスクロール時に再生します。スクロールできるコンテナ（中身がはみ出している横スクロールの行など）の中の要素は、いちばん外側のコンテナの位置で判定します。行が画面の近くにあれば、行の外へはみ出したスライドもそのまま表示します。ページ全体を独自のコンテナでスクロールさせるレイアウトでは、その中の要素をすべてそのまま表示します。位置はハイドレーションの後にブラウザーが報告した位置で判定するため、ハイドレーション中にページや行をスクロールしていても、表示中の要素が消えることはありません。ブラウザーでアニメーションの描画に失敗した要素は、モーションなしの同じ要素として表示します。
- 要素の中へフォーカスが入った場合（キーボード操作など）は、すぐに完成状態で表示します。ハイドレーション後は、フォーカスが外れても完成状態のままです。ハイドレーション前は、フォーカスがある間だけ完成状態になります。
- ブラウザーへ渡すのは、データバインディング・表示条件・repeatをサーバーで解決し、部品スキーマで再検証した表示内容だけです。バインディングの式、取得したデータのうち表示しない値、スキーマで宣言していないフィールドは含めません（独自部品の緩いスキーマは例外。後述）。

`builderPlugin()`と`builderIntegration()`に`motion: false`を渡すと、すべてのページをスクリプトなしの静的表示にします。保存済みの`motion`は表示に使わず、MCPのガイドもモーションを使わない内容になります。登録されるルートはislandを含まない表示を使うため、islandのコードも`componentsModule`の部品もブラウザー向けにビルドしません。独自ルートで`PageShell.astro`を使う場合はislandのコードがビルドされます（ページには出力しません）。

独自部品は`motion: true`を指定し、一番外側の要素を`Root`で1回だけ描画します。

```tsx
Notice: defineComponent({
  props: z.object({ text: z.string().max(2000) }),
  description: 'お知らせを表示する部品',
  motion: true,
  component: ({ props, Root }) => <Root as="aside" className="notice">{props.text}</Root>,
}),
```

- スキーマに`motion`が追加され、MCPのカタログでも対象として表示されます。`motion`は予約済みのプロパティ名で、独自に定義できません。
- `Root`はモーションがなければ通常のタグを、あれば同じタグをMotionで出力します。部品がMotionをimportする必要はありません。`as`には`div`・`section`・`article`・`aside`・`header`・`footer`・`figure`・`blockquote`・`ul`・`ol`・`li`・`p`・`span`・`a`・`img`・`h2`〜`h6`を指定できます（既定は`div`）。`img`のように子を持たないタグには子を渡しません。
- `Root`の要素へ`opacity`・`transform`のCSSを指定しないでください。待機中の透明と再生中の移動に競合します。
- モーションが有効（既定）な場合、`componentsModule`はislandのためブラウザー向けにもバンドルされます。サーバー専用のAPIや秘密情報をimportしないでください。
- モーションのあるページでは、独自部品のpropsもislandを通じてブラウザーへ渡ります。ネストした`z.object`で宣言していないフィールドは落とします。`z.looseObject`・`.catchall()`・`z.record`・`z.unknown`・`z.any`で宣言したpropは値がそのまま届くため、部品が描画するフィールドだけを宣言してください。値はJSONの形で届き、日付はISO 8601の文字列になり、`$`で始まるキーは除きます。

CSPを独自に設定するホストでは、すべてのページでテーマのstyle属性（`.site`の`style`）を許可してください。モーションのあるページでは、さらに自オリジンのモジュールscript、Astroのislandが出力するインラインの`<script>`と`<style>`、JavaScript無効時用の`<noscript>`内のインライン`<style>`、動く要素のstyle属性を許可してください。モーションのないページと`motion: false`では、islandのscriptと`<noscript>`のstyleを出力しません。パッケージ既定のCSPは`frame-ancestors`・`object-src`・`base-uri`だけを制限します。

### 権限と検証

プレビュー発行はEmDashの`content:read_drafts`権限に従います。匿名とSubscriberは拒否し、Contributor・Author・Editor・Adminは許可します。MCPでは加えて`mcp:tools:builder`スコープが必要です。管理画面は標準セッションを使います。EmDash 1.3.1のプラグインRESTルートをPATで直接呼ぶ場合は`admin`スコープも必要ですが、ロールによる権限チェックは引き続き適用されます。署名リンクは発行から15分有効で、コレクションと1ページに限定されます。

- `vp run test`: ロール別の発行可否・署名対象・15分の有効期間、独自部品の検証とSSR、モーションの検証とハイドレーション、設定とエディターの対象を確認します。
- `vp run smoke`: ローカルAPI/MCPで署名改ざん・期限切れ・別コレクション/ページへの流用・スコープ不足を確認します。`.env`または環境変数に、起動中のサーバーと同じ`EMDASH_PREVIEW_SECRET`が必要です。
- `vp run test:package`: 一時ホストに配布物をインストールし、実ユーザーのロール別HTTP権限、標準構成と独自部品・保存先・URLを変えた構成を開発/本番SSRで確認します。モーションのあるページだけがislandを読み込み、ほかのページがスクリプトなしで表示されること、`motion: false`ではislandと独自部品がブラウザー向けにビルドされないことも確認します。テスト用ユーザーとトークンは一時ホストのDBにだけ作成します。

## ライセンス

MIT
