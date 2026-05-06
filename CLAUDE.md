# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリのコードを扱う際のガイドラインを提供します。

## このプロジェクトの最終目標

このプロジェクトの最終目標は以下の通り。設計するときに留意せよ

- 「パスを生成（ベジェ曲線）してフォントの形を少しいじったりしてロゴにすることもしたい」
- フォトショやイラストレータの場合は大体「アウトライン生成」をやって、テキストをアウトライン化してからパスにして形をいじれると思うが、そういう風にはしたい

## コマンド

- `npm start` — ビルド（両方のtsconfig）を実行し、Electronを起動
- `npm run build` — mainとrendererのみをコンパイル（起動はしない）
- `npm test` — Jest でユニットテストを実行（ts-jest 経由）
- `npm run dist:win` — Windows向け Portable .exe をビルド
- `npm run pack` — wine不要の unpacked ビルド（動作確認用）

## テスト

Jest + ts-jest を使用。テストファイルは `test/` 配下。

```bash
npm test              # 全テスト実行
npx jest --watch      # ウォッチモード
npx jest copy-export  # 特定ファイルのみ
```

テスト対象モジュール（すべて `src/core/` 配下、pure function、dual-mode export パターン）:
- `path/types.ts` — 共通型定義 (Point / PathCommand / HandleRef / PathAnchor) と `assertNever`
- `path/anchors.ts` — パスアンカー抽出・移動
- `path/fabric-adapter.ts` — fabric 生タプル ↔ PathCommand 境界変換
- `outline-position.ts` — アウトライン位置計算
- `copy-export.ts` — PNG エクスポート用 typed wrapper

## ディレクトリ構成 (3層レイアウト)

```
src/
├── main.ts / preload.ts  # Electron main/preload
├── core/                 # ドメインロジック (DOM/fabric/Electron 非依存、テスト可)
│   └── path/             # path 操作のドメイン (中核概念。今後 path 関連が増えたらここへ)
├── renderer/             # view (DOM/fabric/Electron に触れる)
└── globals/              # ambient .d.ts (Window 拡張など外部世界の型)
```

新しいファイルを追加する時はこの分類に従ってください。`core/` は pure function のみ、`renderer/` は副作用あり、`globals/` は他から型シムが必要な時だけ。path 関連のロジック (アンカー、ハンドル、ベジェ評価、コマンド変換など) は `core/path/` 内に。

## ビルド構成 (tsc + esbuild)

3 段階のビルドパイプライン (`npm run build`):

1. **`build:main`** = `tsc -p tsconfig.json` → `src/main.ts`, `src/preload.ts` を `dist/{main,preload}.js` にコンパイル (CommonJS, Node API)
2. **`build:typecheck`** = `tsc -p tsconfig.renderer.json` (noEmit) → `src/core/**` + `src/renderer/**` の型検査のみ
3. **`build:renderer`** = `node esbuild.renderer.mjs` → `src/renderer/app.ts` をエントリに `dist/renderer/bundle.js` に IIFE バンドル

`tsconfig.test.json` は ts-jest 用 (CommonJS, `include` は `test/**` のみ。test ファイルが import で source を参照する経路で型解決される)。

### renderer の ES モジュール構成

`renderer/index.html` は 3 つの `<script>` だけ読み込む:
```
<script src="vendor/fabric.min.js"></script>
<script src="vendor/fontkit.js"></script>
<script src="../dist/renderer/bundle.js"></script>
```

fabric / fontkit は `renderer/vendor/` から `<script>` でグローバル読み込みされ、esbuild バンドルには含まれない。本体コード (core + renderer) は esbuild が単一 IIFE バンドルにまとめる。

ソースコードは普通の ES モジュールとして書く (`export function foo()` / `import { foo } from '...'`)。dual-mode export パターンや globalThis 注入は不要。

`tsconfig.renderer.json` の `"allowUmdGlobalAccess": true` により、@types/fabric が UMD として宣言する `fabric` 名前空間を import 文無しで直接参照できる (vendor script 経由のグローバルとして runtime 解決される)。fontkit の global 型宣言は `src/globals/fontkit.d.ts`。

### 新しい core / renderer ファイルを追加するとき

esbuild が import グラフを follow して自動でバンドルに含めるので、`renderer/index.html` を触る必要は無い。型エラーが出ないように `tsconfig.renderer.json` の include グロブ (`src/core/**/*.ts` / `src/renderer/**/*.ts`) に該当することを確認するだけで OK。

`src/globals/electron-api.d.ts` は両方の tsconfig で共有され、`window.electronAPI` ブリッジを定義します。

## アーキテクチャ

**Electron（3つのプロセス）:**

- `src/main.ts` — BrowserWindowを作成し（contextIsolation: on, nodeIntegration: off）、IPC ハンドラを登録：
  - `save-png` — ネイティブ保存ダイアログ経由で PNG をディスクに書き込み
  - `copy-image` — `nativeImage` + `clipboard.writeImage` でクリップボードに画像書き込み（サンドボックス有効の preload では clipboard/nativeImage が使えないため main 側で処理）
  - `log` — renderer → electron-log 中継
  - `toggle-devtools`, `zoom-in/out/reset`, `toggle-fullscreen` — HTML メニュー用
  - ネイティブメニューは `Menu.setApplicationMenu(null)` で非表示化
- `src/preload.ts` — `contextBridge` を介して `window.electronAPI` を公開。`savePng`, `copyImageToClipboard`, `onMenuCopy`, View 系 IPC を中継
- `src/renderer/app.ts` — renderer エントリーポイント。esbuild が IIFE バンドルでラップするので本体は普通の ES モジュール。UI 状態 (mode、selection)、fabric イベント配線、各モードへのディスパッチ、`FabricToolHost` adapter (fabric ↔ tool 抽象境界) を保持。ツール本体は `core/tools/*` に分離済
- `src/renderer/logger.ts` — IPC + DevTools console を束ねる `logger` オブジェクト
- `src/renderer/toast.ts` — `showToast(message, isError?)` (3秒で消える簡易通知)
- `src/renderer/menu-bar.ts` — `initMenuBar(handleAction)` (HTML メニューバーの開閉 UI、アクションは callback 経由)
- `src/renderer/font-enumeration.ts` — Local Font Access API でシステムフォントを列挙し、family/style セレクトを populate
- `src/renderer/outline-conversion.ts` — `outlineTextToPath()` の純粋寄り変換 (fabric.Text → fabric.Path、fontkit 経由)。canvas 操作を含む `outlineSelection` は app.ts に残る

**カスタム HTML メニューバー:**

ネイティブ Electron メニューの代わりに HTML ベースのメニューバーを使用（`renderer/index.html` の `#menu-bar`）。Claude Desktop 風のスタイルで、CSS でフォントサイズや間隔を制御可能。メニューの開閉ロジックは `app.ts` 冒頭の `initMenuBar()` で実装。

**文字モデル（重要 — コードからは分かりにくい点）:**

ユーザーが `fabric.IText` の入力を完了すると、`commitIText()` がそれを**1文字ごとの `fabric.Text` オブジェクト**に分割します。各文字オブジェクトは `data: { groupId, charIndex, sourceText }` を保持します。同じITextから生成された文字は同じ `groupId` を共有します。文字の間隔はFabricの機能ではなく、オフスクリーンキャンバスの `measureText` 呼び出しによって計算されます。

これがコアデータモデルです。「単語」は、`data.groupId` によってのみリンクされた N 個の独立した Fabric オブジェクトです。ある文字が属する単語を取得する必要がある機能は、`canvas.getObjects()` を `groupId` でフィルタリングする必要があります。

**3つのモード** (`currentMode`):

- `select-group` (黒矢印) — 1つの文字をクリックすると、`expandSelectionToGroup()` を通じて同じ `groupId` を持つすべての文字を自動的に選択します。
- `select-char` (白矢印) — 文字単位の選択。移動時のグリッドスナップはこのモードでのみ適用されます（Altキーで一時的にスナップを無効化できます。Illustrator風の挙動）。アウトライン化済みパスのアンカーポイント編集もこのモードで行います。
- `text` — キャンバスの空き領域をクリックして `IText` を生成します。このモードが有効な間、既存のオブジェクトは選択不可（selectable: false）およびイベント無効（evented: false）になります。

`setMode()` はキャンバス上のすべてのオブジェクトの `selectable`/`evented` を切り替えるため、将来新しいオブジェクトタイプを追加する場合は、このループと整合性を保つ必要があります。

**Enter確定フロー:** キャプチャフェーズの `document.addEventListener('keydown', ..., true)` が、IText編集中のEnterキーを遮断して `exitEditing()` を呼び出します。実際のコミット処理は `text:editing:exited` ハンドラ（Escキーや枠外クリックでも発火）で行われ、3つすべての終了パスを1つのロジックに集約しています。コミットロジックをkeydownハンドラに移動させないでください。

**アウトライン化 (Cmd/Ctrl+Shift+O):**

`outlineTextToPath()` が `fabric.Text` を `fabric.Path` に変換します。fontkit でグリフパスを取得し、SVG `d` 文字列を経由して `fabric.Path` を生成。変換後のパスは `data: { ...origData, outlined: true }` を保持し、元の `groupId` を引き継ぎます。

**アンカーポイント編集 (白矢印モード):**

`select-char` モードでアウトライン化済みパス (`data.outlined === true`) が選択されると、`contextTop` にアンカーマーカーを描画。DOM capture phase の `mousedown` で fabric より先にアンカーヒットテストを行い、ヒット時は `stopImmediatePropagation` でパス全体のドラッグを抑止してアンカーのみを移動。ドラッグ完了時に `_setPositionDimensions` で bbox を再計算し、`pathOffset` の変化分を `left`/`top` に補正して視覚位置を維持。

**DPI スケーリング注意:** `contextTop` への描画時は `canvas.getRetinaScaling()` で retina 倍率を掛ける必要がある。`setTransform(1,0,0,1,0,0)` ではなく `setTransform(retina,0,0,retina,0,0)` を使用すること。

**クリップボードコピー (Ctrl+C / メニュー Edit > Copy):**

選択オブジェクトを `exportObjectToPngDataUrl()` (typed wrapper, `src/core/copy-export.ts`) 経由で 10 倍解像度の透過 PNG にレンダリングし、IPC `copy-image` でメインプロセスの `clipboard.writeImage` に渡す。

重要: `fabric.Object.prototype.toCanvasElement(options)` は **options オブジェクト** (`{ multiplier: 10 }`) で呼ぶ必要がある。`toCanvasElement(10)` と positional arg で渡すと `options.multiplier` が `undefined` になり 1 倍でレンダリングされる（Canvas-level の同名メソッドとは API が異なる）。この落とし穴は `copy-export.ts` の typed wrapper で型安全に防止されている。

**ズーム:** Alt + ホイールで、カーソル位置を中心にズームします (`canvas.zoomToPoint`)。Photoshop風の挙動で、範囲は `[0.1, 20]` に制限されています。

## 長期的方向性 (新しいコードを書く際の指針)

アウトライン化とアンカーポイント移動 (Phase 2a) は実装済みです。今後は以下を段階的に実装予定:

- **Phase 2b**: bbox 再計算の改善、Undo/Redo、複数アンカー同時選択
- **Phase 2c**: ベジェハンドル (制御点) の表示・編集
- **Phase 2d**: アンカーの追加/削除、スムーズ/コーナー変換
- **Phase 2e**: アンカードラッグ時のグリッドスナップ

新機能への指針:

- 移動、選択、スナップのロジックは、`fabric.Text` 特有のフィールドではなく、**汎用的なプロパティ** (`target.left`, `target.top`, `target.angle` など) に対して記述してください。スナップハンドラが良いテンプレートになります。
- `data` にテキスト専用のフィールドを追加しないでください（以前は `data.baselineY` がありましたが、この方針のために削除されました）。
- Illustrator、Photoshop、FigmaなどのUX慣習を優先してください（例：Altキーによる一時的な制約解除、Cmd+Shift+Oによるアウトライン化など）。これらは明確な意図を持った操作体系です。

## 将来的な構造改善: ドメイン層に `Selection` を一級概念として置く

現在「現在の選択は何か」というドメイン概念が複数の場所に分散して住んでいます:

- `canvas.getActiveObject()` (fabric の生状態)
- `host.getActiveObjects()` / `setActiveSelection()` (一応の boundary だが書き手の一つに過ぎない)
- `menuSelectAll` / `outlineSelection` 等は host を経由せず直接 fabric API を叩く
- `commitIText` は `hasControls` 等の選択時挙動を per-object のプロパティとして埋め込む
- `select-char` モードの fabric 自然 selection event は host 不経由
- アンカー / ハンドルの選択は tool ローカルの `drag` フィールドで管理

加えて `active.type === 'activeSelection'` のような **fabric の文字列型タグでドメインが分岐** しているコードもあり (`syncToolbarToSelection` など)、抽象化の漏れが起きています。

### なぜ必要か

1. **不変条件が構造で守れない**: 例えば「N=1 でも N≥2 でも変形可能なエンティティで wrap される」という cardinality 不変条件が、複数の経路に依存するため一箇所では担保できない。実際 1 文字選択時にハンドルが出ないバグ (`commitIText` の `hasControls: false` を per-object に埋め込んでいたことに起因) はこの分散の結果。
2. **テストできない**: 選択の振る舞いが fabric の event / 各 tool / 各 menu にまたがって決まるため、純粋関数として spec を書けない。pure function でテスト可能な不変条件にするにはドメイン側が一級概念を持つ必要がある。
3. **path/anchor 編集の複雑化**: 今後ハンドル選択 / アンカー選択 / 文字選択 / 複数アンカー同時選択 が混在する。一級概念の `Selection` がないと整理しきれなくなる。

### 目指す構造

```
┌──────────────────────────────────┐
│  Selection (domain, single SoT)  │  ← 全 read/write はこれ経由
└─────────┬─────────────┬──────────┘
          │             │
   ┌──────▼─────┐  ┌────▼──────────┐
   │ fabric     │  │ toolbar /     │
   │ adapter    │  │ tools         │
   │ (render)   │  │ (subscribe)   │
   └────────────┘  └───────────────┘
```

- fabric の selection event は adapter 経由で `Selection` を更新
- tool / toolbar / outline 等は `Selection` を読み、変更は `Selection` API のみ
- `Selection` は N=1 / N≥2 / アンカー選択 / ハンドル選択を統一的に表現
- fabric は render backend として扱う (state holder ではない)

導入タイミングは Phase 2d 以降の選択複雑化が始まる手前あたりが目安。新しい機能を足す際、この方向と整合する形で実装してください (例: 新しい選択経路を追加するなら host 経由を徹底し、fabric API 直叩きを増やさない)。

## UI言語

ツールバーのラベル、ツールチップ、トーストメッセージには**日本語**を使用しています。新しいユーザー向け文字列を追加する場合も、これに合わせて日本語を維持してください。
