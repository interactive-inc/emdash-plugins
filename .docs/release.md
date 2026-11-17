# npmへの公開

`packages/emdash-plugins`を`@interactive-inc/emdash-plugins`としてnpmへ公開する手順。公開は検査やデプロイとは別の明示的な操作で、取り消せない（同じバージョン番号は二度と使えない）。

## 準備

1. 公開するコミットをmainに置き、作業ツリーを空にしてoriginと揃える。
2. `packages/emdash-plugins/package.json`の`version`と`src/builder/constants.ts`の`pluginVersion`を同じ値に上げる。一致は`tests/builder/constants.test.ts`が確認する。
3. 開発アプリを停止し、`vp install`の後に`vp run release`を通す。[検査の分担](testing.md)を参照。
4. `packages/emdash-plugins`で`vp pm publish --dry-run`を実行し、ビルドと同梱ファイル（`dist`・`src`・README・LICENSE、テストを含まない）を確認する。

## 公開

- 公開するnpmアカウントは2FAが有効で、`@interactive-inc`スコープへの書き込み権限（組織のdeveloper以上）を持つ。`npm whoami`で確認する。
- `npm login`と`vp pm publish`は、ブラウザーでの認証とワンタイムコードを求める。公開する人が自分の端末で実行する。AIエージェントの自動実行では行わない。

```sh
cd packages/emdash-plugins
vp pm publish
```

## 公開後の確認

- `npm view @interactive-inc/emdash-plugins versions dist-tags`で、新しいバージョンが`latest`になったことを確認する。
- 新しいパッケージの初回は、npmのstaged publishingにより、先に`0.0.0-stage`という2ファイルだけの仮版が`latest`として現れる。npmの自動検証が終わると本物の版に置き換わる。0.1.0では数分かかり、承認の操作は不要だった。仮版はバージョン一覧に残るが、インストールには影響しない。
- 長時間現れない場合は、npmjs.comのアカウント設定の**Staged Packages**か`npm stage list`で承認待ちを確認し、あれば2FAで承認する。

## タグ

公開を確認してから、同じコミットに`v<version>`の注釈付きタグを付けてpushする。`v*`タグで`Release checks`が動き、CIでも同じ検査を実行する。タグもワークフローもnpmへは公開しない。

```sh
git tag -a v0.1.0 -m "@interactive-inc/emdash-plugins 0.1.0" <commit>
git push origin v0.1.0
```
