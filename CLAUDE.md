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

テスト対象モジュール (pure function / fabric 不知。DOM/fabric/Electron 不要で動く):

- `core/path/types.ts` — 共通型定義 (Point / PathCommand / HandleRef / PathAnchor) と `assertNever`
- `core/path/anchors.ts` — パスアンカー抽出・移動
- `core/path/coords.ts` — 座標変換 (path local ↔ world ↔ screen)
- `renderer/path-adapter.ts` — fabric 生タプル ↔ PathCommand 境界変換 (Interface Adapter)
- `core/object-id.ts` — ObjectId / ObjectType / ensureObjectId (ulid 経由)
- `core/history/stack.ts` — HistoryStack (ring buffer + cursor)
- `core/outline-position.ts` — アウトライン位置計算
- `renderer/copy-export.ts` — PNG エクスポート用 typed wrapper (Interface Adapter)
- `core/group-selection.ts` — group 展開ロジック
- `core/path/segment-hit.ts` — セグメントヒットテスト
- `core/path/overlay-layout.ts` — overlay (アンカー / ハンドル) 配置
- `tools/select-char-tool.ts` / `tools/pen-add-tool.ts` / `tools/pen-remove-tool.ts` / `tools/select-group-tool.ts` / `tools/text-tool.ts` — `FakePathHandle` / `FakeState` (= State interface のテストダブル) を渡して挙動を検証

## ディレクトリ構成 (4 層レイアウト)

```
src/
├── main.ts / preload.ts  # Electron main/preload
├── core/                 # ドメイン (Entity 相当)。pure、DOM/fabric/Electron 非依存
│   ├── path/             # path 操作のドメイン (中核概念)
│   ├── history/          # Command ADT + HistoryStack (state-jump 用)
│   ├── state.ts          # State interface (= 抽象契約)
│   └── object-id.ts      # ObjectId / ObjectType / ensureObjectId
├── tools/                # 入力 adapter (CA でいう Controller 相当)
│                         # pure、DOM/fabric 非依存だが domain ではない
│                         # ユーザー入力を受けて State を介して mutate する
├── renderer/             # view (DOM/fabric/Electron に触れる、CA でいう Frameworks)
│   └── state.ts          # State の concrete 実装 (fabric を内包)
└── globals/              # ambient .d.ts (Window 拡張など外部世界の型)
```

新しいファイルを追加する時はこの分類に従ってください:
- **`core/`** は pure function + 抽象契約 (interface)。DOM/fabric/Electron に触れない。Entity / domain types / pure 計算
- **`tools/`** はユーザー入力 (PointerInput) を受けて State 経由で mutation を起こす Controller 層。fabric/DOM 不知だが domain でもない。**core から物理的に分離**することで「これは入力 adapter であって domain ではない」を明示
- **`renderer/`** は副作用あり (DOM/fabric/Electron)。State の concrete 実装、UI 配線、event dispatcher
- **`globals/`** は他から型シムが必要な時だけ

path 関連のロジック (アンカー、ハンドル、ベジェ評価、コマンド変換など) は `core/path/` 内に。tool の各実装は `tools/` 内に。

## ビルド構成 (tsc + esbuild)

3 段階のビルドパイプライン (`npm run build`):

1. **`build:main`** = `tsc -p tsconfig.json` → `src/main.ts`, `src/preload.ts` を `dist/{main,preload}.js` にコンパイル (CommonJS, Node API)
2. **`build:typecheck`** = `tsc -p tsconfig.renderer.json` (noEmit) → `src/core/**` + `src/tools/**` + `src/renderer/**` の型検査のみ
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

### 新しい core / tools / renderer ファイルを追加するとき

esbuild が import グラフを follow して自動でバンドルに含めるので、`renderer/index.html` を触る必要は無い。型エラーが出ないように `tsconfig.renderer.json` の include グロブ (`src/core/**/*.ts` / `src/tools/**/*.ts` / `src/renderer/**/*.ts`) に該当することを確認するだけで OK。

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
- `src/renderer/app.ts` — renderer エントリーポイント。esbuild が IIFE バンドルでラップするので本体は普通の ES モジュール。UI 状態 (mode、selection)、DOM 入力ディスパッチ、UI handler (commitIText / outline / delete 等) を保持。fabric の操作は `state` instance を経由する。ツール本体は `tools/*` に分離済
- `src/renderer/state.ts` — fabric.Canvas を **encapsulate** した State モジュール。State interface 実装 + History 操作 (undo/redo) + 永続化 stub を提供。fabric の癖 (path 配列の直接代入 / `_setPositionDimensions` / pathOffset 補正 / ActiveSelection の座標系) はすべてこの中に閉じ込められている。詳細は本ファイル後段の「Tool との関係」「ファイル構成」セクション参照
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

選択オブジェクトを `exportObjectToPngDataUrl()` (typed wrapper, `src/renderer/copy-export.ts`) 経由で 10 倍解像度の透過 PNG にレンダリングし、IPC `copy-image` でメインプロセスの `clipboard.writeImage` に渡す。

重要: `fabric.Object.prototype.toCanvasElement(options)` は **options オブジェクト** (`{ multiplier: 10 }`) で呼ぶ必要がある。`toCanvasElement(10)` と positional arg で渡すと `options.multiplier` が `undefined` になり 1 倍でレンダリングされる（Canvas-level の同名メソッドとは API が異なる）。この落とし穴は `copy-export.ts` の typed wrapper で型安全に防止されている。

**ズーム:** Alt + ホイールで、カーソル位置を中心にズームします (`canvas.zoomToPoint`)。Photoshop風の挙動で、範囲は `[0.1, 20]` に制限されています。

## 長期的方向性 (新しいコードを書く際の指針)

実装済み:

- **Phase 2a**: アウトライン化とアンカーポイント移動
- **Phase 2c**: ベジェハンドル (制御点) の表示・編集 (`core/path/types.ts` の `HandleRef` / `incomingHandle` / `outgoingHandle`、`core/path/anchors.ts` の `getHandlePoint` / `moveHandle`、`core/path/overlay-layout.ts` の `HandleScreenPos` / `hitTestHandleAt`、`tools/select-char-tool.ts` の handle drag)
- **Phase 2d (一部)**: アンカーの追加/削除 (`tools/pen-add-tool.ts` / `pen-remove-tool.ts`)
- **State / Viewport 分離モデル + Undo/Redo**: 全 state 変更操作 (アンカー編集 / アンカー追加削除 / object 移動拡縮回転 / プロパティ変更 / 文字確定 / アウトライン化 / 削除) を履歴対象とする state-jump semantic で実装。Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z で操作。詳細は本ファイル後段「Undo/Redo + 永続化に向けた State / Viewport 分離モデル」セクション参照

今後実装予定:

- **永続化 (save / load)**: 上記 state model の延長で実装可能。フォーマットは `canvas.toJSON(['data'])` の出力 (= ObjectSnapshot[]) をそのまま使う。詳細は同セクション末尾「永続化」参照
- **bbox 再計算の改善**: `pathOffset` 補正の精緻化
- **複数アンカー同時選択**
- **スムーズ / コーナーアンカーの変換**
- **アンカードラッグ時のグリッドスナップ**

新機能への指針:

- 移動、選択、スナップのロジックは、`fabric.Text` 特有のフィールドではなく、**汎用的なプロパティ** (`target.left`, `target.top`, `target.angle` など) に対して記述してください。スナップハンドラが良いテンプレートになります。
- `data` にテキスト専用のフィールドを追加しないでください（以前は `data.baselineY` がありましたが、この方針のために削除されました）。
- Illustrator、Photoshop、FigmaなどのUX慣習を優先してください（例：Altキーによる一時的な制約解除、Cmd+Shift+Oによるアウトライン化など）。これらは明確な意図を持った操作体系です。

## Undo/Redo + 永続化に向けた State / Viewport 分離モデル

mojiplay の状態を 2 層に分けて扱う。**State = ドキュメント = 履歴 / 永続化対象**、**Camera = ephemeral = 履歴 / 永続化対象外** という分離を徹底することで、undo/redo は state の snapshot を丸ごと書き戻す `state-jump` semantic で実現でき、永続化はこの state を JSON 化するだけで得られる。差分計算 / 位置補正は不要。

3D ソフト (Blender 等) / CAD / Figma などと同じ model。

### 層構造

```
┌─────────────────────────────────────────────────┐
│ State (ドキュメント層、永続化対象、undo 対象)   │
│                                                 │
│  - 全 object (path / text)                      │
│  - 各 object の commands / left / top /          │
│    scaleX / scaleY / angle / fill / fontFamily  │
│  - 「絶対座標」(viewport の影響を受けない)      │
│  - fabric では canvas.getObjects() の各          │
│    fabric.Object に対応                          │
└─────────────────────────────────────────────────┘
                     │
                     ▼ レンダリング時に viewport で変換
                     │
┌─────────────────────────────────────────────────┐
│ Camera 層 (永続化対象外、undo 対象外)           │
│                                                 │
│  - Viewport: zoom / pan                          │
│    (canvas.viewportTransform、Alt + ホイール)    │
│  - Selection: どの object/anchor/handle が active│
│  - Tool mode: 黒矢印 / 白矢印 / 文字 / pen 等    │
│  - IText 編集中の入力 state                      │
└─────────────────────────────────────────────────┘
                     │
                     ▼
                  画面 (pixels)
```

fabric は最初からこの 2 層を分離して持っている (`canvas.objects` vs `canvas.viewportTransform`、レンダリング時に viewport を適用する)。我々は新たな state holder を別途持たず、**「state は履歴 / 永続化対象、camera はそうじゃない」というルールを徹底する**だけ。

### Tool との関係 (入力 → State 変更の流れ)

Tool は `src/tools/*` に置かれ **pure コード (fabric / DOM 不知)**。State の読み書きは `State` / `PathHandle` という interface 越しにのみ行う (interface は `core/state.ts`、実装は `renderer/state.ts` が encapsulate している)。

#### (a) ユーザー操作で State を変える流れ

```
                    User Input
              (DOM mouse / keyboard /
               toolbar / menu)
                       │
                       ▼
        ┌──────────────────────────────────┐
        │ Dispatcher (renderer/app.ts)     │
        │  - mousedown を current tool に   │
        │  - toolbar change → applyTo...   │
        │  - menu → handleMenuAction       │
        └────────────────┬─────────────────┘
                         │
                         ▼
        ┌──────────────────────────────────┐
        │ Tool (tools/*)              │
        │   pure、fabric/DOM 不知           │
        │                                   │
        │   - SelectGroupTool               │
        │   - SelectCharTool                │
        │   - TextTool                      │
        │   - PenAddTool                    │
        │   - PenRemoveTool                 │
        │                                   │
        │ 入力 (PointerInput) を受け、操作を│
        │ 計算し、副作用は host 経由で発火  │
        └─┬─────────────────────────────┬──┘
          │                             │
   State / PathHandle                State.
   (read state, set commands)         pushCommand
          │                             │
          ▼                             ▼
 ┌──────────────────────────────────────────────────────┐
 │ State (renderer/state.ts) — State interface 実装  │
 │                                                       │
 │  ┌────────────────────────┐  ┌────────────────────┐  │
 │  │ canvas (fabric.Canvas) │  │ HistoryStack       │  │
 │  │  - objects             │  │  (Command 列、     │  │
 │  │    (= State の実体)     │  │   ring buffer)     │  │
 │  │  - viewportTransform   │  │                    │  │
 │  │    (= Camera 層)        │  │                    │  │
 │  └────────────────────────┘  └────────────────────┘  │
 │                                                       │
 │  private 関数群:                                      │
 │   - makePathHandle / makeObjectHandle (canonical 化)  │
 │   - captureObjectSnapshot                             │
 │   - writeSnapshotToCanvas / createObjectOnCanvas /    │
 │     removeObjectFromCanvas                            │
 │   - applyCommand / revertCommand                      │
 │   - fabric event hook (mouse:down / object:modified): │
 │     fabric-driven な transform を Command 化して       │
 │     historyStack.push する                            │
 └────────────────────┬─────────────────────────────────┘
                      │
                      ▼ canvas.objects がレンダリングされ、
                        canvas.viewportTransform を適用
                  画面 (pixels)
```

#### (b) Undo / Redo で State を戻す流れ

```
       Cmd+Z / Cmd+Shift+Z (DOM keyboard)
                       │
                       ▼
        ┌──────────────────────────────────┐
        │ handleUndo / handleRedo          │
        │ (renderer/app.ts、1 行 wrapper)  │
        └────────────────┬─────────────────┘
                         │ state.undo() / state.redo()
                         ▼
 ┌──────────────────────────────────────────────────────┐
 │ State (renderer/state.ts)                            │
 │                                                       │
 │   内部処理:                                           │
 │     1. historyStack.undo() / .redo() で Command 取得 │
 │     2. private な applyCommand(cmd) /                 │
 │        revertCommand(cmd) を呼ぶ                      │
 │     3. compound なら逆順 (revert) / 順次 (apply) で   │
 │        要素 Command 毎に処理                           │
 │     4. snapshot ヘルパで canvas.objects を更新         │
 │     5. canvas.requestRenderAll()                      │
 │                                                       │
 │   Phase A 規約: undo/redo は selection を能動的に     │
 │   触らない (camera 層は履歴対象外)                    │
 └────────────────────┬─────────────────────────────────┘
                      │ canvas.objects 更新 → 再レンダリング
                      ▼
                  画面 (pixels)
```

#### 設計のキー: Tool は core / 副作用は host 経由のみ

- **Tool は core/ レイヤ** に住む。fabric も DOM も知らないので `FakeState` / `FakePathHandle` を渡すだけで unit test 可能 (138 既存 cases)
- **State 変更の副作用は host 経由** に限定:
  - 中間更新 (drag 中) は `path.setCommands(cmds)` (PathHandle interface)
  - drag finalize は `path.finalizeEdit()` で bbox 補正 (PathHandle interface)
  - Command の push は `host.pushCommand(cmd)` (State interface)
  - 選択変更は `host.setActiveSelection(handles)` (State interface)
  - text 生成は `host.createTextAt(x, y, props)` (State interface)
- **fabric を直接 import しない**ので、将来 fabric 以外の renderer に置き換えても tool は無修正で動く (理論上)
- **state.ts に encapsulate**: contract (interface) は `core/state.ts` の `interface State`、実装は `renderer/state.ts` の `class State implements StateContract` (alias 経由)。State interface 実装 + PathHandle 実装 + HistoryStack 内包 + fabric event hook 配線をまとめて担う。fabric の生 API は renderer/state.ts 内のみ。app.ts は state instance を経由して fabric を操作する

#### Tool の責任分担

| 操作 | 起点 tool | history への push |
|---|---|---|
| アンカー / ハンドル drag | `select-char-tool.ts` | `pointerUp` で `host.pushCommand({ kind: 'objectChanged', ... })` |
| アンカー追加 | `pen-add-tool.ts` | 同上 |
| アンカー削除 | `pen-remove-tool.ts` | `pointerDown` (1 click 完結) で push |
| 文字確定 | `text-tool` (host.createTextAt 経由)、commitIText が compound push | `commitIText` (`app.ts`) で N×`objectCreated` を `compound` で push |
| object 移動 / scale / rotate | `select-group-tool.ts` (実は no-op、fabric の自然挙動) | `app.ts` の `mouse:down` / `object:modified` hook で `e.action` 判別して push |
| toolbar property 変更 | tool 経由ではなく直接 `applyToSelection` (`app.ts`) | 同上で before/after capture して push |
| アウトライン化 / Delete | tool 経由ではなくメニュー / ボタン (`app.ts`) | それぞれの handler で compound push |

つまり **drag 系操作 (anchor edit / pen) は tool 内で push、その他 (object transform / property / 作成 / 削除) は app.ts の dispatcher / event hook で push**。両方 `host.pushCommand` (= `historyStack.push`) を経由する単一経路。

### 用語の対応: State / Camera と具体的な型・変数

| AA の層 | 具体的な型 / 場所 |
|---|---|
| **State** (ドキュメント層) | `ObjectSnapshot[]` (= 全 object を snapshot 化したリスト) |
| └ State の 1 要素 | **`ObjectSnapshot`** (`fabric.Object.toObject(['data'])` 出力の薄いラッパー) |
| **Camera 層** (viewport) | `canvas.viewportTransform` |
| **Camera 層** (selection) | 現状散らばっている (将来 `Selection` 抽象に集約、本ファイル末尾参照) |
| **Camera 層** (tool mode) | `currentMode` 変数 (`app.ts`) |
| **Camera 層** (IText 編集中 state) | fabric.IText の編集モード内部状態 |

`ObjectSnapshot` は State 層の "原子" (= 1 object 分)、State 全体は `ObjectSnapshot` の集合。Command の `before` / `after` フィールドはこの `ObjectSnapshot`、永続化は `ObjectSnapshot[]` を JSON 化したもの。

### 履歴対象 / 対象外の operation 一覧

履歴対象 (state を変更する全操作):

| 操作 | Command 種別 | 起点 |
|---|---|---|
| アンカー / ハンドル編集 (drag) | `objectChanged` | `select-char-tool.ts` |
| アンカー追加 (pen) | `objectChanged` | `pen-add-tool.ts` |
| アンカー削除 (pen) | `objectChanged` | `pen-remove-tool.ts` |
| object 移動 / 拡大縮小 / 回転 | `objectChanged` (multi-select は `compound`) | `app.ts` の `mouse:down` / `object:modified` hook |
| object プロパティ変更 (font / size / color / angle via toolbar) | `objectChanged` (multi-select は `compound`) | `applyToSelection` (`app.ts`) |
| テキスト入力確定 (commitIText) | `compound` of N×`objectCreated` | `commitIText` (`app.ts`) |
| アウトライン化 (Cmd+Shift+O) | `compound` of N×(`objectDeleted` Text + `objectCreated` Path) | `outlineSelection` (`app.ts`) |
| object 削除 (Delete キー / メニュー) | `objectDeleted` (multi-select は `compound`) | `menuDeleteSelection` (`app.ts`) |

履歴対象外 (camera 層 / ephemeral):

- viewport zoom / pan (Alt + ホイール)
- selection (どの object が active か) — Illustrator 形式
- tool 選択 (どのモードが active か)
- IText 編集中の文字入力 — commit で 1 step として履歴に積む。commit 前の入力単体は global Cmd+Z で `bypass` される

### Command ADT

```ts
// src/core/history/types.ts
import type { ObjectId, ObjectType } from '../object-id';

// fabric.Object.toObject(['data']) の出力をそのまま使う薄いラッパー。
// type / data / left / top / scaleX / scaleY / angle / fill / path / text 等を含むが、
// TS 的には Record<string, unknown> として扱い、data フィールドだけ shape を保証する。
export type ObjectSnapshot = Record<string, unknown> & {
  data: { objectId: ObjectId; type: ObjectType };
};

export type Command =
  | { kind: 'objectChanged'; objectId: ObjectId; before: ObjectSnapshot; after: ObjectSnapshot }
  | { kind: 'objectCreated'; objectId: ObjectId; after:  ObjectSnapshot }
  | { kind: 'objectDeleted'; objectId: ObjectId; before: ObjectSnapshot }
  | { kind: 'compound';      commands: ReadonlyArray<Command> };

export interface HistoryStack {
  push(cmd: Command): void;
  undo(): Command | null;
  redo(): Command | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  linearize(): ReadonlyArray<Command>;
}
```

`switch` は `assertNever` で網羅性保証 (Phase B/C で kind が増えても対応漏れがコンパイル時に検出される)。

### state-jump semantic と意図された制約

undo/redo は **`ObjectSnapshot` を path に丸ごと書き戻す** だけの単純操作。差分計算 / 位置補正 / 対称性などの「fabric 座標モデルに依存した数学」を一切持たない。

#### 状態モデルが完全である

任意の path の視覚位置は

```
bboxCenterWorld = (left, top) + R(angle) · diag(scaleX, scaleY) · pathOffset
```

で完全に決まる。ここで `pathOffset` (および `width` / `height`) は **`commands` から `_setPositionDimensions` で決定論的に算出される派生値**。したがって snapshot として保持すべき独立した state は **`{ commands, left, top, scaleX, scaleY, angle, fill, ... }`** だけで、これを書き戻せば視覚位置は一意に再現する。

実装上は `fabric.Object.toObject(['data'])` の出力を `ObjectSnapshot` としてそのまま使う (= path / text のフィールド全部含む)。

#### 履歴外の操作の扱い

camera 層 (selection / viewport / tool mode / IText 編集中) は履歴対象外なので、それらが undo/redo で巻き戻ることは無い。

ただし state 層内でも **mojiplay の Phase A が "全 state 変更を履歴対象" を採用した結果**、Photoshop / Illustrator が tracked にしている操作 (move / rotate / scale / プロパティ変更 / 作成 / 削除 / アウトライン化) は全て履歴に乗る。これにより「履歴外の transform 変化を保つ」という暫定セマンティクスは不要になり、state-jump で完結する。

### apply / revert 実装

`HistoryStack` は **「履歴を覚える」だけ**で fabric は触らない。Command を実際に canvas へ反映するのは `renderer/state.ts` 内 (private な `applyCommand` / `revertCommand`) の責務。同じく state.ts 内の private snapshot ヘルパ (`writeSnapshotToCanvas` / `createObjectOnCanvas` / `removeObjectFromCanvas`) を呼ぶ。

```ts
// renderer/state.ts 内 (class State の private メソッド)
private applyCommand(cmd: Command): void {
  switch (cmd.kind) {
    case 'objectChanged': this.writeSnapshotToCanvas(cmd.after); break;
    case 'objectCreated': this.createObjectOnCanvas(cmd.after); break;
    case 'objectDeleted': this.removeObjectFromCanvas(cmd.objectId); break;
    case 'compound':      cmd.commands.forEach(c => this.applyCommand(c)); break;
    default: { const _: never = cmd; return _; }
  }
  this.canvas.requestRenderAll();
}

private revertCommand(cmd: Command): void {
  switch (cmd.kind) {
    case 'objectChanged': this.writeSnapshotToCanvas(cmd.before); break;
    case 'objectCreated': this.removeObjectFromCanvas(cmd.objectId); break;
    case 'objectDeleted': this.createObjectOnCanvas(cmd.before); break;
    case 'compound':      [...cmd.commands].reverse().forEach(c => this.revertCommand(c)); break;
    default: { const _: never = cmd; return _; }
  }
  this.canvas.requestRenderAll();
}
```

`compound` は **逆順で revert** (= apply の逆順序で打ち消す)。

#### snapshot ヘルパ (state.ts 内 private)

state.ts 内に閉じた private 関数群が ObjectSnapshot ⇔ fabric.Object の境界変換を担う:

- **`captureObjectSnapshot(obj)`** = `obj.toObject(['data'])` (= 1 行ラッパー)。app.ts の高レベルハンドラ向けに同名 method を public にも公開している
- **`writeSnapshotToCanvas(snapshot)`** = type に応じて per-property に書き戻し:
  - **path**: `(p as any).path = snapshot.path` で commands 配列を直接代入 (fabric 内部の正規化を回避) → `set({ left, top, scaleX, scaleY, angle, fill })` で transform / style → `_setPositionDimensions` で width / height / pathOffset を再算出
  - **text / i-text**: `set({ text, left, top, scaleX, scaleY, angle, fill, fontFamily, fontSize, fontWeight, fontStyle })` で一括
  - 最後に `data` を snapshot から restore (objectId / type は immutable だが groupId 等の custom field を保持)
- **`createObjectOnCanvas(snapshot)`** = type に応じて手動で `new fabric.Path(pathData, options)` / `new fabric.Text(text, options)`、`canvas.add` で追加。`fabric.util.enlivenObjects` は同期保証が無いため不採用 (将来 image 等で必要になったら検討)
- **`removeObjectFromCanvas(objectId)`** = `resolveObjectById` で fabric.Object を解決して `canvas.remove`
- **`resolveObjectById(id)`** = `canvas.getObjects().find(o => o.data?.objectId === id)`

### Tool-driven vs fabric-driven の区別 (重要)

object:modified イベントは **2 つの起点**から飛んでくる:

1. **fabric-driven**: 黒矢印モードで object を drag / scale / rotate したとき、fabric が internal で発火 (`e.action` = 'drag' / 'scale' / 'rotate' 等が入る)
2. **tool-driven**: 白矢印 (アンカー / ハンドル編集) / pen tool が `finalizeDrag` 内で `canvas.fire('object:modified', { target: p })` を呼ぶ (action 無し)

両者は**まとめて Command 化したくない**。fabric-driven は global handler で `objectChanged` Command を作るが、tool-driven は **tool 自身が `host.pushCommand` で既に積んでいる** ため、global handler が処理すると **二重 push** になる。

これを区別するために **`e.action` の有無** を見る:

```ts
// src/renderer/app.ts (object:modified hook)
canvas.on('object:modified', (e) => {
  // ... 共通ログ ...
  const action = (e as any).action;
  if (!action) return;  // tool-driven な finalizeDrag からの fire は無視

  // fabric-driven の transform を Command 化
  // ActiveSelection は子毎に Command 生成 → compound にまとめる
  ...
});
```

#### 前後 snapshot の捕捉

fabric-driven の場合:

- `mouse:down`: `e.target` が fabric.Object なら、その snapshot を `transformBeforeSnapshots: Map<ObjectId, ObjectSnapshot>` に保存。ActiveSelection なら子毎に保存
- `object:modified`: 上記 Map から取り出して `before`、`captureObjectSnapshot(obj)` で `after`、`objectChanged` Command を構築 (multi なら `compound`)

tool-driven の場合は tool 内部で:

- `pointerDown`: `path.captureForHistory()` で before snapshot を tool ローカルに保持
- `pointerUp`: `path.finalizeEdit()` 後に `path.captureForHistory()` で after を取得、`host.pushCommand({ kind: 'objectChanged', ... })` を呼ぶ

`PathHandle` interface は **`getId()` と `captureForHistory()`** を持つ (`core/state.ts`)。実装は `renderer/state.ts` 内 private な `makePathHandle(p: fabric.Path)` で `data.objectId` 取り出しと `toObject(['data'])` を返す薄いラッパー。

### Tool 側の Command 構築

各 tool の `pointerDown` で `beforeSnapshot` を private field に保持し、`pointerUp` で `host.pushCommand` する形:

```ts
// src/tools/select-char-tool.ts (anchor / handle drag)
onPointerDown(e, host): PointerHandled {
  const path = host.getActivePath();
  // ... hit test ...
  this.dragPath = path;
  this.beforeSnapshot = path.captureForHistory();
  return 'consumed';
}

onPointerUp(_e, host): void {
  const p = this.dragPath; const before = this.beforeSnapshot;
  this.drag = null; this.dragPath = null; this.beforeSnapshot = null;
  p.finalizeEdit();
  if (before) {
    const after = p.captureForHistory();
    if (JSON.stringify(after) !== JSON.stringify(before)) {  // no-op drag は skip
      host.pushCommand({ kind: 'objectChanged', objectId: p.getId(), before, after });
    }
  }
}
```

`pen-add-tool.ts` / `pen-remove-tool.ts` も同パターン (それぞれ pointerDown 直後 / 削除直前で before を捕捉)。`JSON.stringify` での before/after 比較は no-op drag を skip するための安価なチェック (fabric の toObject 出力は実用上決定論的)。

### IText 編集中の挙動

- IText 編集中 (`active.isEditing === true`) は global Cmd+Z handler で **bypass し、何もしない**
- 編集 commit (Enter / Esc / クリックアウェイ) → `commitIText` 内で **「N 個の Text 作成」を 1 個の compound Command として push**
- IText 自体は履歴対象外 (ephemeral): `objectDeleted` を積まない。undo すると「commit 直前の canvas 状態」 = 「これらの char が無い状態」に戻る
- 編集中の文字入力に対する細かい undo は実装しない (fabric.IText は内蔵 undo を持たないため、ユーザーは backspace 等で対処する)

### Toolbar property change

`applyToSelection(props)` (`app.ts`) は active object 群に `obj.set(props)` で書き込むが、各 object について before / after snapshot を捕捉して `objectChanged` Command を push (multi-select は `compound`):

```ts
function applyToSelection(props): void {
  const active = canvas.getActiveObjects();
  const cmds: Command[] = [];
  for (const obj of active) {
    const id = obj.data?.objectId;
    if (!id) continue;
    const before = captureObjectSnapshot(obj);
    obj.set(props);
    const after = captureObjectSnapshot(obj);
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      cmds.push({ kind: 'objectChanged', objectId: id, before, after });
    }
  }
  canvas.requestRenderAll();
  if (cmds.length === 1) historyStack.push(cmds[0]);
  else if (cmds.length > 1) historyStack.push({ kind: 'compound', commands: cmds });
}
```

font family / size / color / rotation 全部この経路。

### `HistoryStack` のデータ構造: ring buffer + cursor

固定長の循環バッファ (`Command[max]`) と論理 cursor で実装する:

- **state**: `buf` (固定長 array) / `head` (logical index 0 が指す物理 index) / `size` (有効エントリ数) / `cursor` (最後に apply 済みの logical index、-1 = 何も無い)
- **アクセス**: 物理 index = `(head + logicalIndex) % max`
- **push**:
  - `size = cursor + 1` で redo 列を切り捨て
  - `size < max` なら末尾に書き込んで `size++; cursor++`
  - `size === max` なら `buf[head]` を上書きし `head = (head + 1) % max` (古い側を捨てる、O(1))
- **undo**: `cursor--` のみ (バッファは不変)
- **redo**: `cursor++` のみ (バッファは不変)

debug / 永続化のための `linearize()` ヘルパで論理順の Command 列を返す。

選定理由: 上限超過時の旧履歴破棄が O(1)、メモリが固定で predictable、mod 計算コストは無視できる範囲。

実装: `src/core/history/stack.ts`、テストは `test/history-stack.test.ts` (12 ケース、wrap-around / 上限超過 / undo→redo / 各 edge case)。

### ID と type の分離 (重要設計判断)

**ObjectId は pure ULID (branded string) として保持**し、**type 情報は別フィールド (`data.type`) に置く**。両者を ID 文字列に混在させない。

理由:

- ULID の lexicographic sort 性質 (時系列順) を完全保持。将来 SQLite に保存する場合の B-tree index 効率と直結
- ID は identity に専念、type は type に専念 (単一責任)
- `fabric.Object.data` のシリアライズ / Map のキー / 等価比較 (`a === b`) すべて plain string として自然に動く
- 「prefix で型判別」が欲しい log 用途は formatter ヘルパで対応 (後述 `fmtObj`)

type と ID の関係:

- `ensureObjectId(obj, type)` で ID を発行する瞬間に `data.type` も確定
- 一度確定した `data.type` は **immutable** (object の lifecycle 中に書き換えない)
- type が変わる操作 (例: outline 化 = `fabric.Text` → `fabric.Path`) は **「古い object を destroy + 新しい object を create」** として扱う。同じ identity を維持しない (= compound Command の `objectDeleted` + `objectCreated`)

### `ObjectId` infra

ULID 生成は `ulid` パッケージの `monotonicFactory` を `core/object-id.ts` 内で直接呼ぶ (薄いラッパーモジュールは作らない — ライブラリの API は十分シンプル、indirection の価値が無い)。monotonic 化は **必須** (drag finalize や複製操作で同一 ms に複数発行が起きるため)。仕様: https://github.com/ulid/spec

```ts
// src/core/object-id.ts
import { monotonicFactory } from 'ulid';

const newUlid = monotonicFactory();

export type ObjectId = string & { readonly __brand: 'ObjectId' };
export type ObjectType = 'text' | 'path';

export interface IdentifiableData {
  objectId?: ObjectId;
  type?:     ObjectType;
}

export function ensureObjectId(
  obj: { data?: IdentifiableData },
  type: ObjectType,
): ObjectId {
  const data = obj.data ?? (obj.data = {} as IdentifiableData);
  if (!data.objectId) {
    data.objectId = newUlid() as ObjectId;
    data.type = type;
  }
  return data.objectId;
}
```

`commitIText` / `outlineTextToPath` の object 生成箇所で `ensureObjectId(obj, 'text' | 'path')` を呼んで ID と type を確保する。

### log フォーマッタ `fmtObj`

```ts
// src/renderer/logger.ts
export function fmtObj(obj: fabric.Object | null | undefined): string {
  if (!obj) return '<null>';
  const d = (obj as any).data;
  if (d?.type && d?.objectId) {
    return `${d.type}:${String(d.objectId).slice(0, 8)}`;  // 例: "text:01HK7A12"
  }
  return `<noid:${(obj as any).type ?? '?'}>`;
}
```

**規律**: log で fabric.Object を識別したい場合は必ずこの関数を経由する (生 ULID を log に出さない)。

`[history] push kind=...` / `[history] undo kind=...` / `[history] redo kind=...` の各経路で動作確認用 log が出ているので、debug 時はこれらを見ると undo/redo の動きが追える。`historyStack.linearize()` を console から呼べば履歴全体も俯瞰できる。

### 全体フロー (3 経路)

#### (1) push 経路: ユーザーが操作したとき

**fabric-driven (黒矢印 drag / scale / rotate)**:

```
mouse:down (fabric)
   ↓
transformBeforeSnapshots に object 毎の snapshot を保存
   ↓
[ユーザー drag]
   ↓
object:modified (fabric, e.action = 'drag' 等)
   ↓
transformBeforeSnapshots から before を取り出し
captureObjectSnapshot で after
   ↓
historyStack.push (single または compound)
```

**tool-driven (白矢印 / pen-add / pen-remove / 文字確定 / outline / delete / toolbar)**:

```
Tool が直接 host.pushCommand(cmd) を呼ぶ
(canvas は既に "after" 状態に live 更新済みなので apply の二重呼び出しは不要)
```

#### (2) undo 経路: Cmd/Ctrl+Z

```
keydown (Cmd/Ctrl+Z, IText 編集中なら bypass)
   ↓
handleUndo()
   ↓
const cmd = historyStack.undo()
   ↓
revertCommand(canvas, cmd)
   ↓
canvas.requestRenderAll() (revertCommand 内)
```

#### (3) redo 経路: Cmd/Ctrl+Shift+Z

```
keydown (Cmd/Ctrl+Shift+Z)
   ↓
handleRedo()
   ↓
const cmd = historyStack.redo()
   ↓
applyCommand(canvas, cmd)
```

### app.ts での controller 配線

```ts
// src/renderer/app.ts (要点抜粋)
const state = new State(canvas, { historyMax: 100 });

function handleUndo(): void { state.undo(); }
function handleRedo(): void { state.redo(); }

// IText 編集中は browser のテキスト undo に任せる (fabric.IText は内蔵 undo 無しなので
// 実質「edit 中は何も起きない」が、global Cmd+Z で commit 前 IText が消えるのを避ける)
document.addEventListener('keydown', (e) => {
  const active = canvas.getActiveObject() as fabric.IText | null;
  if ((active as any)?.isEditing) return;
  const meta = e.ctrlKey || e.metaKey;
  if (!meta) return;
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
  if ((e.key === 'Z') || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); handleRedo(); }
}, true);
```

`state` は State interface を実装しているので、各 tool には `state` を直接渡す (`tool.onPointerDown(input, state)` など)。tool が history を直接持たず State 越しに `pushCommand` で push することで、tool 側を fabric / history 実装から切り離す。

### ファイル構成 (実装後)

```
src/core/
├── object-id.ts             ObjectId / ObjectType / ensureObjectId
│                            (ulid パッケージの monotonicFactory を直接利用)
├── state.ts                 State interface (= 抽象契約)。Tool / app / menu の共通
│                            操作 IF + PathHandle / ObjectHandle / PathSnapshot /
│                            TextCreateProps を集約。fabric / DOM 不知
└── history/
    ├── types.ts             Command ADT + ObjectSnapshot + HistoryStack interface
    └── stack.ts             ring buffer + cursor 実装

src/renderer/
├── state.ts                 `class State implements StateContract` (alias)。core/state.ts
│                            の State 契約に対する fabric.Canvas を内包する concrete 実装。
│                            History 操作 / 永続化 stub / 公開 captureObjectSnapshot
│                            ヘルパ。private に snapshot 境界変換、applyCommand /
│                            revertCommand、HistoryStack 参照、fabric event hook
│                            (mouse:down / object:modified、arrow メソッドで
│                            `this` binding を保つ) を全て持つ。fabric の生 API は
│                            このファイル内に閉じ込め
├── logger.ts                既存 + fmtObj() ヘルパ
└── app.ts                   state instance 作成 (`new State(canvas)`)、DOM 入力
                             ディスパッチ、Cmd+Z バインド、commitIText /
                             outlineSelection / menuDelete / applyToSelection の
                             Command 化 (state.captureObjectSnapshot + state.pushCommand
                             を経由)

src/tools/
├── tool-interface.ts        Tool / ToolDescriptor / PointerInput / MovingTarget /
│                            CanvasMouseDownInput (Tool method は State を引数で受ける)
├── select-char-tool.ts      pointerDown で before、pointerUp で after を捕捉して push
├── pen-add-tool.ts          同上
└── pen-remove-tool.ts       同上 (1 click 操作なので pointerDown 直前で before)

test/
├── object-id.test.ts        ensureObjectId の挙動 (6 cases)
└── history-stack.test.ts    HistoryStack (12 cases、wrap-around / overflow / undo→redo 含む)
```

### 重要な設計ポイント (まとめ)

1. **state-jump semantic を一貫採用**: undo/redo は snapshot を丸ごと書き戻す。差分計算 / 位置補正ロジックは持たない
2. **state と camera を物理的に分離**: state は `canvas.objects`、camera は `canvas.viewportTransform` 他。history も persistence も state のみが対象
3. **`ObjectSnapshot` は `fabric.Object.toObject(['data'])` 出力**: 自動的に永続化フォーマットと一致する (後付けの format 変換が要らない)
4. **`HistoryStack` は fabric を知らない**: pure data 責務に専念。fabric への反映は adapter のみ
5. **switch は `assertNever` で網羅性保証**: Phase B/C で Command kind が増えたとき対応漏れがコンパイルエラーになる
6. **camera (viewport / selection / tool mode / IText 編集中) は history に積まない**: 変更しても history に影響しない
7. **compound command は逆順 revert**: `[a, b, c]` を apply したら revert は `[c, b, a]` の順で各々 revert
8. **type が変わる操作は新規 ID を発行する**: outline 化 (Text→Path) は同一 identity を維持せず、`objectDeleted`(Text) + `objectCreated`(Path) の compound として扱う
9. **`e.action` の有無で fabric-driven / tool-driven を区別**: 二重 push を防ぐ (tool-driven は tool 自身が pushCommand 済み)
10. **path 書き戻しの `path` 配列は `set()` 経由ではなく直接代入**: fabric の内部正規化を回避し、`_setPositionDimensions` で派生値を再算出する経路を確実に通す

### Selection 抽象互換性のための規約 (実装方針として継続)

将来 Selection 抽象 (本ファイル末尾の「将来的な構造改善」参照) を導入したとき書き直さなくて済むよう以下を遵守:

1. **Command は ID ベース**: `fabric.Object` 参照ではなく `ObjectId` で対象を表す (実装済)
2. **ID → fabric.Object の解決を 1 箇所に閉じ込める**: `renderer/state.ts` 内 private な `resolveObjectById` のみが解決責任を持つ
3. **undo/redo は selection を能動的に切り替えない**: undo した object が active になっていれば視覚的に変化が見える、それで足りる
4. **新しい選択経路を追加するなら host 経由を徹底**: `active.type === 'activeSelection'` 等の fabric 文字列タグ依存を新規に増やさない

### テスト戦略

`core/` 配下は pure data なので unit test で完結:

- **`core/object-id.ts`**: ensureObjectId が同じ obj に 2 回呼ばれても同じ ID を返す、type は ID 確定時に同時に書かれる、type 引数違いでも変わらない、別 obj には別 ID (6 cases)。ULID 生成自体のテストは書かない (= ライブラリ側の責務、自前で再追試しても資産価値ゼロ)
- **`core/history/`**: HistoryStack の基本性質 (push 後 canUndo true、新 push で redo 列クリア、上限超過時 overwrite で古い側が落ちる、wrap-around 跨ぎでの linearize、空 / 部分 / フル状態の各 edge case)、`createHistoryStack({ max: < 1 })` がエラー (12 cases)

`select-char-tool.ts` 等のツール側は `FakeState` / `FakePathHandle` 経由で existing test (155 通過) が引き続き成立。FakeState に `pushCommand` を追加、FakePathHandle に `getId` / `captureForHistory` を追加した。

`applyCommand` / `revertCommand` の fabric への副作用部分 (`writeSnapshotToCanvas` 等) は Phase A では integration 化せず目視確認に留める。state-jump semantic なので test 観点は「snapshot の値が path に正しく書き戻されるか」「`_setPositionDimensions` で派生値が再算出されるか」「`new fabric.Path/Text` で正しく object が復元されるか」のみ。

### UI スコープ

- Cmd/Ctrl+Z = undo、Cmd/Ctrl+Shift+Z = redo (capture phase で fabric / browser より先に取る)
- IText 編集中 (`active.isEditing`) は global handler を bypass
- メニューの「編集 > 元に戻す / やり直す」も同 handler に接続 (`handleMenuAction` の `'undo'` / `'redo'` ケース)
- 履歴上限はハードコード `max: 100`。設定 UI は将来の話

### 永続化 (今後実装する場合の指針)

state model から自然に得られる:

```ts
// save
const fileContent = JSON.stringify({
  version: 1,
  objects: canvas.toJSON(['data']),  // viewport は含めない (objects のみ)
});

// load
const parsed = JSON.parse(fileContent);
canvas.clear();
canvas.loadFromJSON(parsed.objects, () => {
  canvas.viewportTransform = [1, 0, 0, 1, 0, 0];  // viewport は default にリセット
  canvas.requestRenderAll();
});
historyStack.clear();  // 慣例: load 後は history リセット
```

履歴とは独立。**snapshot 形式が `fabric.Object.toObject(['data'])` の出力と一致しているので、永続化機能を後付けするときに format 設計をやり直す必要が無い**。format バージョニング / 圧縮 / 入れ子 schema は将来必要に応じて。

## 将来的な構造改善: camera 層の selection を一級概念として整理する

### 位置付け

State / Viewport 分離モデル ([前述の Undo/Redo セクション](#undoredo--永続化に向けた-state--viewport-分離モデル) 参照) では、mojiplay の状態は **state (document、永続化 / 履歴対象) と camera (ephemeral)** に分かれる。

Selection は **camera 層の一部** に位置付けられる:

| Camera 層の構成要素 | 内容 | 履歴 / 永続化 |
|---|---|---|
| Viewport | zoom / pan (`canvas.viewportTransform`) | 対象外 |
| Selection (本セクションの対象) | どの object / anchor / handle が active か | 対象外 (Illustrator 形式) |
| Tool mode | 現在のツール (黒矢印 / 白矢印 / 文字 / pen-add / pen-remove) | 対象外 |

つまり Selection の整理は **camera 層の整理** であり、state / history / 永続化とは独立した課題。

### 現状の散らばり (依然として残っている)

「現在の選択は何か」というドメイン概念が複数の場所に分散している:

- `canvas.getActiveObject()` (fabric の生状態)
- `host.getActiveObjects()` / `setActiveSelection()` (一応の boundary だが書き手の一つに過ぎない)
- `menuSelectAll` / `outlineSelection` 等は host を経由せず直接 fabric API を叩く
- `commitIText` 等で `hasControls` のような選択時挙動を per-object プロパティに埋め込む
- `select-char` モードの fabric 自然 selection event は host 不経由
- アンカー / ハンドルの選択は tool ローカルの `drag` フィールドで管理 (= 別レイヤだが、object 選択と協調する場面で経路が分かれている)

加えて `active.type === 'activeSelection'` のような **fabric の文字列型タグでドメインが分岐** しているコードもある (`syncToolbarToSelection` など)。

### なぜ依然として必要か (動機の更新版)

1. **構造的な書き手散乱** (= 元 motivation 1 を再評価):
   - 1 文字選択時のハンドルが出ないバグは `hasControls: true` の 1 行修正で fix 済み (`commitIText` 内)。**表面的な修正**で済んだ
   - だが「N=1 と N≥2 で active object の型が違う」「writer が複数経路にいる」という構造は残っているので、**今後同型のバグが別の形で再発し得る** (例: ボーダー色がついたりつかなかったり、トランスフォーム挙動が一致しないなど)

2. **camera 層の概念整理が中途半端**:
   - State / Viewport 分離モデルでは camera 層を ephemeral として明確に位置付けたが、その内部 (selection / viewport / tool mode) はバラバラに住んでいる
   - viewport は `canvas.viewportTransform` 1 箇所、tool mode は `currentMode` 変数 1 箇所、selection は **N 箇所**。selection だけ整理が必要

3. **テスト可能性**:
   - 選択の振る舞いが fabric の event / 各 tool / 各 menu にまたがって決まるので pure function として spec を書けない
   - ドメイン側が一級概念を持てば selection のロジックは pure に書けて test できる

4. **将来の機能で確実に痛む**:
   - 「複数アンカー同時選択」(milestone に既存) は anchor 選択を tool ローカルに閉じ込めたままだと辛い
   - 「object と anchor を同時に選択」「shift クリックで anchor を追加選択」など、現在の tool-local drag state では表現しきれないケースが出る
   - 「Cmd+A で全選択」を anchor / object に応じて切り替える、なども一級概念がないと配線が散る

### 目指す構造

```
┌─────────────────────────────────────┐
│  Selection (domain, single SoT)     │  ← 全 read/write はこれ経由
│  - kind: 'objects' | 'anchors' |    │
│          'handles' | 'none'         │
│  - ObjectId[] / AnchorRef[] / ...    │
└──────────┬──────────────┬───────────┘
           │              │
   ┌───────▼──────┐  ┌────▼──────────┐
   │ fabric       │  │ toolbar /     │
   │ adapter      │  │ tools /       │
   │ (render)     │  │ menu actions  │
   └──────────────┘  │ (subscribe)   │
                     └───────────────┘
```

- fabric の selection event (`selection:created` / `:updated` / `:cleared`) は adapter 経由で `Selection` を更新
- tool / toolbar / outline / menu 等は `Selection` を読み、変更は `Selection` API のみ
- `Selection` は object 選択 (N=1 / N≥2) と anchor / handle 選択 (sub-selection) を統一的に表現
- selection は履歴対象外 (camera 層)。Undo/Redo は selection を触らない

### ObjectId infra との関係

Undo/Redo 実装で導入された `ObjectId` (pure ULID) を、Selection の identity にそのまま使う:

```ts
type Selection =
  | { kind: 'none' }
  | { kind: 'objects'; ids: ReadonlyArray<ObjectId> }
  | { kind: 'anchors'; pathId: ObjectId; anchorIndices: ReadonlyArray<number> }
  | { kind: 'handles'; pathId: ObjectId; handle: HandleRef };
```

fabric.Object の生参照を持たないので、永続化や undo 後の object 復元 (`enlivenObjects` で新 instance 化) でも参照が切れない。

### 導入タイミング

Undo/Redo + 永続化が一段落した後、**複数アンカー同時選択** (milestone 既存) の実装手前が自然なタイミング。複数 anchor 選択は selection の sub-selection 機能を本格的に必要とする最初の機能で、ここで Selection 抽象を入れない場合 tool ローカル drag state にさらに複雑な data 構造を詰め込むことになる。

新しい機能を足す際は、この方向と整合する形で実装してください:

- 新しい選択経路を追加するなら host 経由を徹底し、fabric API 直叩きを増やさない
- `active.type === 'activeSelection'` のような fabric 文字列タグでの分岐を新規には書かない (host 越しに `getActiveObjects()` の length で判定する)
- ハンドル / アンカー選択を扱う新しい機能は、tool-local drag state を拡張する前に「これは Selection 抽象に乗せるべきか」を一度検討する

## CA (Clean Architecture) 用語での現アーキテクチャの整理

mojiplay は **CA をそのまま採用しているわけではない** が、CA 用語を借りると現在の境界と妥協が説明しやすい。**新コードを書く際の判断材料** として、各 mojiplay モジュールが CA 的にどの層に属するかを記録しておく。

### 層と mojiplay モジュールの対応

| CA 層 (内→外) | 役割 | mojiplay での該当 |
|---|---|---|
| **Entities** (innermost) | 業務 object / pure rules | `core/path/*` (PathCommand / HandleRef / `moveAnchorRigid` 等)、`core/object-id.ts`、`core/history/types.ts` の Command ADT |
| **Use Cases** | アプリ固有操作 | (散在) `tools/*.ts` の onPointerDown/Up 内の操作ロジック、`renderer/state.ts` の undo / redo / serialize、`app.ts` の commitIText / outlineSelection / menuDeleteSelection / applyToSelection |
| **Interface Adapters: Controller** | UI 入力 → 内部呼び出し | `tools/*.ts` (PointerInput → State 操作)、`app.ts` の DOM event dispatcher (mousedown / keydown / toolbar change) |
| **Interface Adapters: Presenter** | Use Case 出力 → view 形式 | `renderer/state.ts` 内 private な `writeSnapshotToCanvas` / `createObjectOnCanvas` / `removeObjectFromCanvas` (Command / snapshot → fabric.Canvas 状態変更) |
| **Interface Adapters: Gateway** | 外部 IO のラッパー | `renderer/state.ts` 内 private な `resolveObjectById` / public な `captureObjectSnapshot` (fabric.Canvas へのアクセス) |
| **Frameworks & Drivers** (outermost) | UI / DB / external | fabric.js / DOM / Electron (= `renderer/` 内の fabric 直接利用箇所、`main.ts`、`preload.ts`、HTML / CSS) |

### 依存方向

CA は dependencies が内向き片方向であることを要求する (外側は内側を知ってよい、逆は不可)。mojiplay は基本準拠:

```
core (Entities / 一部 Use Case)  ←  tools (Controller)  ←  renderer (Presenter / Gateway / Frameworks)
       ↑                                ↑
       └── 何にも依存しない              └── core に依存
```

`core/` は何も import しない (path / history / object-id / state interface のみ、fabric/DOM 不知)。`tools/` は core を import するが renderer は不知。`renderer/` は core / tools 両方を import する。

### 癒着している場所 (= 1 モジュールが複数 CA 層を兼ねる)

すべて意図的な短期妥協。CA 厳格にすると refactor 規模が爆発するので Phase A は許容している。

#### 1. Tools は Use Case と Controller を兼ねる

Tool の `onPointerDown / onPointerMove / onPointerUp` は **Controller 役** (= 入力受信) と **Use Case 役** (= 「アンカーを動かす」操作のロジック) を 1 つのメソッドで担う。

Use Case を別 class (`MoveAnchorUseCase` 等) に切り出す ROI は現状低い: 操作粒度が小さく、tool 内に直接書くのが読みやすい。将来 Use Case が複雑化したら切り出す候補。

#### 2. State (`renderer/state.ts`) は Use Case + Presenter + Gateway を兼ねる

`class State` は 3 つの CA 役を 1 class に conflate している:

- **Use Case 部分**: `state.undo()` / `state.redo()` / `state.serialize()` (アプリ固有操作の execution)
- **Presenter 部分**: `private writeSnapshotToCanvas` / `createObjectOnCanvas` / `removeObjectFromCanvas` (Command → view 状態変更)
- **Gateway 部分**: `private resolveObjectById` / 公開 `captureObjectSnapshot` (fabric.Canvas へのアクセス)

これは **fabric.Canvas が view + model を兼ねている fabric の設計に追従した結果**。fabric を pure renderer にするためには、別途 Document state を持って fabric を一方向 sync する必要があるが、その分 state synchronization の複雑性が増す。Phase A は意図的にこの選択をしていない (詳細は本ファイル「camera 層の selection を一級概念として整理する」セクションの「導入タイミング」参照)。

#### 3. core 内に Use Case 性が混在

`core/history/stack.ts` の HistoryStack (ring buffer) は pure data 構造だが、push/undo/redo の semantic はアプリ固有 (mojiplay の undo/redo モデル)。Entity と Use Case の中間。CA 厳密には UseCase 寄りだが、pure data として core に置くのは test 容易性 + dependency 方向の保全のため。

### この整理から導かれる将来的な refactor 候補

順に大きい refactor になる:

1. **Use Case を独立**: `tools/` / `app.ts` / `renderer/state.ts` に散在している operation logic の一部 (= toolbar / menu / button から呼ばれるもの) は `src/renderer/actions/` に切り出し済。残りの tool 内 operation logic を `src/usecases/` に切り出すかは検討中。中規模 refactor
2. **Document state レイヤ導入**: State の Presenter / Use Case / Gateway 癒着を解消。`core/document/` に pure な DocumentState (Map<ObjectId, ObjectState>) を導入し、fabric は pure renderer として一方向 sync する。前述の Selection 抽象とまとめて検討する候補。大規模 refactor

### 新コードを書くときの規律

- 新規ファイルを書くとき、**どの CA 層か** を意識する (Entity / UseCase / Controller / Presenter / Gateway / Framework)
- 上記の「癒着」を新規に増やさない
  - 例: 新しい tool に history 操作を直接書かない (= state 経由)
  - 例: core/ に fabric を新規 import しない (copy-export.ts は既知の例外)
- 既存の癒着を「ついでに直す」誘惑に乗らない (refactor は意識的に、scope を切ってから)

## UI言語

ツールバーのラベル、ツールチップ、トーストメッセージには**日本語**を使用しています。新しいユーザー向け文字列を追加する場合も、これに合わせて日本語を維持してください。
