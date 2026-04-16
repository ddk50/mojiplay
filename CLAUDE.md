# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリのコードを扱う際のガイドラインを提供します。

## このプロジェクトの最終目標

このプロジェクトの最終目標は以下の通り。設計するときに留意せよ

- 「パスを生成（ベジェ曲線）してフォントの形を少しいじったりしてロゴにすることもしたい」
- フォトショやイラストレータの場合は大体「アウトライン生成」をやって、テキストをアウトライン化してからパスにして形をいじれると思うが、そういう風にはしたい

## コマンド

- `npm start` — ビルド（両方のtsconfig）を実行し、Electronを起動
- `npm run build` — mainとrendererのみをコンパイル（起動はしない）
- `npm test` — プレースホルダー（現在テストは未実装）

テストが存在しないため、単一テスト用のランナーはありません。

## ビルド構成 (2つのTypeScriptプロジェクト)

メインプロセスとレンダラープロセスで異なるモジュールシステムとlib設定が必要なため、**2つの個別のtsconfig**を使用してコンパイルします。

- `tsconfig.json` → `src/main.ts`, `src/preload.ts` → `dist/*.js` (CommonJS, Node APIを使用)
- `tsconfig.renderer.json` → `src/renderer/**` → `dist/renderer/*.js` (`"module": "none"`, DOM lib, `types: ["fabric"]`を使用)

`renderer/index.html` は2つのプレーンな `<script>` タグを読み込みます。最初に `node_modules/fabric/dist/fabric.js`、次に `dist/renderer/app.js` です。Fabricは**バンドルされず**、グローバルな `fabric` として消費されます。レンダラーのtsconfigで `"module": "none"` を使用しているのはこのためです。バンダラーを導入せずにレンダラーコードに `import` や `require` を持ち込まないでください。

`src/types/electron-api.d.ts` は両方のtsconfigで共有され、`window.electronAPI` ブリッジを定義します。

## アーキテクチャ

**Electron（3つのプロセス）:**

- `src/main.ts` — BrowserWindowを作成し（contextIsolation: on, nodeIntegration: off）、`ipcMain.handle('save-png', ...)` を処理します。これはネイティブの保存ダイアログを介してbase64データURLをディスクに書き込みます。
- `src/preload.ts` — `contextBridge` を介して `window.electronAPI.savePng(base64)` を公開します。これがレンダラーとメイン間の唯一の通信チャネルです。
- `src/renderer/app.ts` — それ以外すべて。UIの状態、Fabricのイベント接続、ツールロジックを保持する単一の即時実行関数 (IIFE) です。

**文字モデル（重要 — コードからは分かりにくい点）:**

ユーザーが `fabric.IText` の入力を完了すると、`commitIText()` がそれを**1文字ごとの `fabric.Text` オブジェクト**に分割します。各文字オブジェクトは `data: { groupId, charIndex, sourceText }` を保持します。同じITextから生成された文字は同じ `groupId` を共有します。文字の間隔はFabricの機能ではなく、オフスクリーンキャンバスの `measureText` 呼び出しによって計算されます。

これがコアデータモデルです。「単語」は、`data.groupId` によってのみリンクされた N 個の独立した Fabric オブジェクトです。ある文字が属する単語を取得する必要がある機能は、`canvas.getObjects()` を `groupId` でフィルタリングする必要があります。

**3つのモード** (`currentMode`):

- `select-group` (白矢印) — 1つの文字をクリックすると、`expandSelectionToGroup()` を通じて同じ `groupId` を持つすべての文字を自動的に選択します。
- `select-char` (黒矢印) — 文字単位の選択。移動時のグリッドスナップはこのモードでのみ適用されます（Altキーで一時的にスナップを無効化できます。Illustrator風の挙動）。
- `text` — キャンバスの空き領域をクリックして `IText` を生成します。このモードが有効な間、既存のオブジェクトは選択不可（selectable: false）およびイベント無効（evented: false）になります。

`setMode()` はキャンバス上のすべてのオブジェクトの `selectable`/`evented` を切り替えるため、将来新しいオブジェクトタイプを追加する場合は、このループと整合性を保つ必要があります。

**Enter確定フロー:** キャプチャフェーズの `document.addEventListener('keydown', ..., true)` が、IText編集中のEnterキーを遮断して `exitEditing()` を呼び出します。実際のコミット処理は `text:editing:exited` ハンドラ（Escキーや枠外クリックでも発火）で行われ、3つすべての終了パスを1つのロジックに集約しています。コミットロジックをkeydownハンドラに移動させないでください。

**ズーム:** Alt + ホイールで、カーソル位置を中心にズームします (`canvas.zoomToPoint`)。Photoshop風の挙動で、範囲は `[0.1, 20]` に制限されています。

## 長期的方向性 (新しいコードを書く際の指針)

このプロジェクトは将来的に **ベジェパス編集とアウトライン生成** (fabric.Text → fabric.Path) を目指しています。新機能への影響：

- 移動、選択、スナップのロジックは、`fabric.Text` 特有のフィールドではなく、**汎用的なプロパティ** (`target.left`, `target.top`, `target.angle` など) に対して記述してください。スナップハンドラが良いテンプレートになります。
- `data` にテキスト専用のフィールドを追加しないでください（以前は `data.baselineY` がありましたが、この方針のために削除されました）。
- Illustrator、Photoshop、FigmaなどのUX慣習を優先してください（例：Altキーによる一時的な制約解除、Cmd+Shift+Oによるアウトライン化など）。これらは明確な意図を持った操作体系です。

## UI言語

ツールバーのラベル、ツールチップ、トーストメッセージには**日本語**を使用しています。新しいユーザー向け文字列を追加する場合も、これに合わせて日本語を維持してください。
