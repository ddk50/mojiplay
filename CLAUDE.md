# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリのコードを扱う際のガイドラインを提供します。

## このプロジェクトの最終目標

- パスを生成 (ベジェ曲線) してフォントの形を少しいじったりしてロゴにしたい
- フォトショやイラストレータの「アウトライン作成」相当: テキストをアウトライン化してパスにしてから形をいじる

## コマンド

- `npm start` — ビルド + Electron 起動
- `npm run build` — main + renderer ビルド (起動なし)
- `npm test` — Jest (ts-jest 経由)
- `npm run dist:win` / `pack` — Windows portable / unpacked

## ディレクトリ構成 (CA / Hexagonal sibling 階層)

```
src/
├── main.ts / preload.ts  # Electron main/preload (Frameworks & Drivers)
├── core/                 # Entities (pure types / value objects)
│   ├── path/             # Path / Anchors / bezier / coords / overlay-layout / segment-hit
│   ├── history/          # Command ADT + History (ring buffer)
│   ├── document/         # DocumentSnapshot + LoadError ADT
│   ├── state-interface.ts # State interface + Mode / SelectionProps / 各 Handle 型
│   └── object-id.ts      # ObjectId (ULID branded) / ensureObjectId
├── usecases/             # Use Case (Interactor + Output Port)
│   ├── tools/            # PointerInput-driven (黒/白矢印, ペン±, 文字)
│   │   ├── tool-interface.ts   # Tool / PointerInput 等
│   │   └── *-tool.ts           # 各 Tool 実装
│   ├── menu/             # Menu/keyboard-triggered
│   │   ├── menu-action-interface.ts          # MenuAction
│   │   ├── menu-action-registry-interface.ts # MenuActionRegistry
│   │   ├── menu-action-registry.ts           # createMenuActionRegistry factory
│   │   ├── file-io-interactor.ts             # Save/Open orchestration
│   │   └── select-all.ts, ... (各 free function)
│   ├── ui-port-interface.ts    # UIPort: toast / dialog / 画像 clipboard
│   └── host-shell-interface.ts # HostShell: PNG 保存 / zoom / fullscreen / paste/copy/close IPC / log
├── repository/           # Driven adapter (Gateway): port + concrete を sibling 配置
│   ├── document-interface.ts
│   └── file-system-document.ts
├── controllers/          # Interface Adapter (Input、外→内): DOM/fabric event を Use Case に dispatch
│   │                     # ファイル名は -controller suffix 省略 (ディレクトリ名で自明)
│   ├── canvas-input-interface.ts / canvas-input.ts  # pointer/wheel/selection/object event → Tool
│   ├── keyboard-interface.ts    / keyboard.ts       # document keydown → MenuAction / Tool command
│   ├── menu-interface.ts        / menu.ts           # HTML メニューバー + host.onCopyRequest
│   ├── toolbar-interface.ts     / toolbar.ts        # toolbar input/button + mode 切替
│   └── view-interface.ts        / view.ts           # window resize / close guard / title bar
├── renderer/             # Presenter + Frameworks 接触面
│   ├── state.ts          # State concrete (fabric.Canvas を encapsulate + business method)
│   ├── ui-port-impl.ts   # ElectronUIPort
│   ├── electron-host-shell.ts  # ElectronHostShell (window.electronAPI 集約)
│   ├── app.ts            # DI 容器 (~135 行: 依存解決と controllers.attach のみ)
│   └── ...               # logger, toast, copy-export, outline-conversion, anchor-overlay 等
└── globals/              # ambient .d.ts (Window 拡張)
```

| dir                      | CA 用語                       | 方向               | fabric/DOM/Electron |
| ------------------------ | ----------------------------- | ------------------ | ------------------- |
| `core/`                  | Entities                      | (内側)             | 不知                |
| `usecases/`              | Use Case (Interactor + Port)  | (内側)             | 不知                |
| `repository/`            | Interface Adapter (Gateway)   | 永続化             | core のみ依存       |
| `controllers/`           | Interface Adapter (Input)     | **外 → 内**        | DOM/fabric 直接 OK  |
| `renderer/`              | Presenter + Frameworks 接触面 | **内 → 外 + 最外** | 全レイヤ可          |
| `main.ts` / `preload.ts` | Frameworks & Drivers          | 最外               | Electron main / IPC |

**依存方向**: 内側 → 外側を禁止。Controller (外→内) と Presenter (内→外) は方向が逆な別概念。Presenter は実装上 fabric / DOM と癒着しがちで、現状は `renderer/` に同居。

**ファイル命名規約**:

- interface 定義のみ → `*-interface.ts` (例: `state-interface.ts`, `canvas-input-interface.ts`)
- 実装 (class / factory) → ベース名 (例: `state.ts`, `canvas-input.ts`)
- interface ファイルに class / factory を混ぜない (test double が object literal で interface を満たすため。class 型は private field の nominal typing で satisfies 不可)
- ディレクトリ名で role が自明なら suffix 省略 (例: `controllers/canvas-input.ts` であって `canvas-input-controller.ts` ではない)

**シンボル命名**:

- Tool = `*Tool` (例: `SelectCharTool`)
- Stateful menu Use Case = `*Interactor` (例: `FileIOInteractor`)
- Stateless menu Use Case = free function or `MenuAction` wrapper (例: `selectAll(state)`)
- Controller = `*Controller` (例: `CanvasInputController`)。`controllers/` のみに配置。Use Case に Controller suffix は付けない
- interface ↔ class ペア: `XxxController` (interface) + `XxxControllerImpl` (class)

## ビルド構成 (tsc + esbuild)

`npm run build` の 3 段階:

1. `tsc -p tsconfig.json` → main + preload を `dist/{main,preload}.js` (CommonJS, Node API)
2. `tsc -p tsconfig.renderer.json` (noEmit) → core/usecases/repository/controllers/renderer の typecheck
3. `node esbuild.renderer.mjs` → renderer 全体を `dist/renderer/bundle.js` (IIFE)

`renderer/index.html` は 3 つの `<script>` のみ: `vendor/fabric.min.js` / `vendor/fontkit.js` / `dist/renderer/bundle.js`。fabric / fontkit は UMD グローバルとして runtime 解決、`allowUmdGlobalAccess: true` で `import` 文無しで参照可能。

新規 ts ファイル追加時は `tsconfig.renderer.json` の include グロブ (`src/{core,usecases,repository,controllers,renderer}/**/*.ts`) に該当することを確認するだけ。`src/globals/electron-api.d.ts` は両 tsconfig 共有で `window.electronAPI` を定義。

## アーキテクチャ

**Electron 3 プロセス**:

- `src/main.ts` — BrowserWindow (`contextIsolation: on`, `nodeIntegration: off`)。IPC: `save-png` / `copy-image` / `log` / view 系 / `save-mply` (atomic write) / `open-mply` / `confirm-discard` / `app-close-request`。ネイティブメニューは `Menu.setApplicationMenu(null)` で無効化 (HTML メニューバー使用)
- `src/preload.ts` — `contextBridge` で `window.electronAPI` 公開
- `src/renderer/app.ts` — DI 容器 (~135 行)。fabric.Canvas / State / HostShell / UIPort / Repository / FileIOInteractor / Tool 群 / MenuActionRegistry / 5 Controllers を構築して `attach()` するだけ

### 5 Controllers (`controllers/`)

| Controller              | 受ける入力                                                                                    | dispatch 先                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CanvasInputController` | DOM mousedown/move (capture) + fabric mouse:_/selection:_/object:moving/rotating/after:render | Tool (PointerInput 中立化), Alt+wheel zoom, anchor overlay, toolbar 同期                                                        |
| `KeyboardController`    | document keydown (capture + bubble)                                                           | MenuAction (undo/redo/copy/save/open/duplicate/outline/devtools), Tool command (矢印キー), Enter で IText commit                |
| `MenuController`        | HTML メニューバー click + `host.onCopyRequest`                                                | MenuAction                                                                                                                      |
| `ToolbarController`     | toolbar input (font/size/color/rotation/snap) + ボタン + mode buttons                         | `state.applyPropsToSelection` / `state.clearAll` / `host.savePng` / MenuAction / `state.setMode` + tool.onActivate/onDeactivate |
| `ViewController`        | window resize / `host.onCloseGuardRequest` / `fileIO.subscribeDocStatus`                      | canvas resize / title bar / close guard                                                                                         |

**Controller の contract**: 各 Controller は `xxx-interface.ts` + `xxx.ts` の 2 ファイル組。interface 側で public `on*` ハンドラ + `attach`/`detach` を宣言、Impl 側で `class XxxControllerImpl implements XxxController` を export。consumer (app.ts) は interface 側に依存、test double は object literal で interface を満たす。`attach()` / `detach()` は self-wiring の convenience。app.ts の `unload` で全 Controller の `detach()` を呼ぶ。

### 文字モデル (重要 — コードからは分かりにくい)

ユーザーが `fabric.IText` の入力を完了すると、`State.handleTextEditingExited` (private、`text:editing:exited` hook) が**1 文字ごとの `fabric.Text` オブジェクト**に分割。各文字は `data: { groupId, charIndex, sourceText }` を保持し、同じ IText から生成された文字は同じ `groupId` を共有。文字間隔は fabric の内部測定 (`__charBounds`) を流用してペアワイズカーニングを保つ。

「単語」は `data.groupId` でリンクされた N 個の独立した fabric.Object。単語単位で扱う機能は `canvas.getObjects()` を `groupId` でフィルタする。

### 5 モード (`state.getCurrentMode()`)

- `select-group` (黒矢印) — 1 文字クリックで同 `groupId` 全体に展開 (`SelectGroupTool`)
- `select-char` (白矢印) — 文字単位選択。グリッドスナップ (Alt で一時無効、Illustrator 風)。アウトライン化済パスのアンカー / ハンドル編集
- `text` — 空き領域クリックで `IText` 生成。このモード中は既存 obj の `selectable` / `evented` を false に
- `pen-add` / `pen-remove` — アウトライン化済 path のアンカー追加 / 削除

`state.setMode()` は全 obj の `selectable`/`evented` を切り替える (canvas 副作用)。Controller 側 (`ToolbarController.setMode`) は tool の `onActivate`/`onDeactivate` 呼び出しと is-active class 切替を担当。

### 重要な振る舞い

- **Enter 確定フロー**: `KeyboardController` の capture phase が IText 編集中の Enter を遮断して `exitEditing()`。実際の commit は `text:editing:exited` (Esc / 枠外クリックでも発火) を `State.handleTextEditingExited` で受けて 1 文字ずつ fabric.Text に分割する。**コミットロジックを keydown ハンドラに移さないこと** (3 経路を 1 か所で扱うため)
- **アウトライン化 (Cmd+Shift+O)**: `outlineTextToPath()` が fontkit でグリフパスを取得 → SVG `d` → `fabric.Path` を生成。`data: { ...origData, outlined: true }` を付け、`groupId` を引き継ぐ
- **アンカー編集 (白矢印モード)**: `data.outlined === true` なパスが選択されると `contextTop` にマーカー描画。DOM capture phase の `mousedown` で fabric より先にアンカーヒットテスト → ヒット時 `stopImmediatePropagation` でパス全体ドラッグを抑止。drag 完了で `_setPositionDimensions` で bbox 再計算、`pathOffset` 変化分を `left`/`top` に補正
- **DPI スケーリング**: `contextTop` 描画時は `canvas.getRetinaScaling()` を掛ける (`setTransform(retina,0,0,retina,0,0)`)
- **クリップボードコピー (Ctrl+C)**: 選択 obj を `exportObjectToPngDataUrl()` で 10 倍解像度 PNG → IPC `copy-image` → main の `clipboard.writeImage`
- **ズーム**: Alt + ホイールで `canvas.zoomToPoint`、範囲 `[0.1, 20]` (Photoshop 風)
- **`toCanvasElement` 落とし穴**: `fabric.Object.prototype.toCanvasElement(options)` は **options オブジェクト** (`{ multiplier: 10 }`) で呼ぶ。`toCanvasElement(10)` だと undefined になり 1 倍 (Canvas-level と Object-level で signature が違う)。`copy-export.ts` の typed wrapper で防止済

## State / Viewport 分離モデル (= Undo/Redo + 永続化の基盤)

mojiplay の状態は 2 層:

- **State (ドキュメント層)** = 全 object の `commands` / `left,top,scaleX,scaleY,angle` / `fill` / `fontFamily` 等。**履歴 / 永続化対象**
- **Camera 層** = viewport (`canvas.viewportTransform`) / selection / tool mode / IText 編集中 state。**履歴 / 永続化対象外** (ephemeral)

### state-jump semantic

undo/redo は `ObjectSnapshot` (= `fabric.Object.toObject(['data'])` 出力) を canvas に丸ごと書き戻すだけ。差分計算 / 位置補正のような fabric 座標モデル依存の数学を持たない。視覚位置は `bboxCenterWorld = (left, top) + R(angle) · diag(scaleX, scaleY) · pathOffset` で完全に決まり、`pathOffset` / `width` / `height` は `commands` から `_setPositionDimensions` で決定論的に再算出できる。

### Command ADT (`core/history/types.ts`)

```ts
type Command =
  | { kind: 'objectChanged'; objectId: ObjectId; before: ObjectSnapshot; after: ObjectSnapshot }
  | { kind: 'objectCreated'; objectId: ObjectId; after: ObjectSnapshot }
  | { kind: 'objectDeleted'; objectId: ObjectId; before: ObjectSnapshot }
  | { kind: 'compound'; commands: ReadonlyArray<Command> };
```

履歴対象 = state を変える全操作 (アンカー / ハンドル編集、object 移動 / 拡縮 / 回転、toolbar property 変更、文字確定、アウトライン化、削除、複製)。履歴対象外 = camera 層。

### 重要な設計ポイント (落とし穴)

1. **state-jump 一貫採用**: undo/redo は snapshot を丸ごと書き戻し。差分 / 位置補正ロジックを持たない
2. **State (canvas.objects) と Camera (viewportTransform 他) を物理的に分離**: history も persistence も state のみ対象
3. **`ObjectSnapshot` = `fabric.Object.toObject(['data'])` 出力**: 永続化フォーマットと自動一致 (format 変換不要)
4. **`History` は fabric を知らない**: pure data 責務。fabric への反映は `renderer/state.ts` 内 private な `applyCommand` / `revertCommand`
5. **`compound` は逆順 revert**: `[a, b, c]` apply の打ち消しは `[c, b, a]` の順
6. **type が変わる操作は新規 ID 発行**: outline 化 (Text→Path) は `objectDeleted`(Text) + `objectCreated`(Path) の compound
7. **`e.action` の有無で fabric-driven / tool-driven を区別**: `object:modified` には 2 経路 (fabric drag/scale/rotate は `e.action` あり、tool の `finalizeDrag` 経由は無し)。State 内 `handleObjectModified` は `e.action` 無しを skip して二重 push を防ぐ
8. **path 書き戻しの `path` 配列は `set()` 経由ではなく直接代入**: fabric 内部正規化を回避し、`_setPositionDimensions` で派生値再算出経路を通す
9. **before/after の no-op skip**: drag 終了時 `JSON.stringify(before) === JSON.stringify(after)` なら push しない
10. **canonical handle**: `getActiveObjects()` / `getAllObjects()` は同じ `fabric.Object` には同じ `ObjectHandle` instance を返す (WeakMap キャッシュ)。`SelectGroupTool` の `alreadyExpanded` 判定は identity (`===`) に依存

### Tool / Use Case の責任分担

| 操作                         | 起点                                                 | history push                                             |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| アンカー / ハンドル drag     | `select-char-tool`                                   | `pointerUp` で tool 自身が push                          |
| アンカー追加 / 削除          | `pen-add-tool` / `pen-remove-tool`                   | tool 自身が push                                         |
| object 移動 / scale / rotate | fabric の自然挙動                                    | `State.handleObjectModified` で `e.action` 判別して push |
| toolbar property 変更        | `ToolbarController` → `state.applyPropsToSelection`  | State 内で before/after capture + push                   |
| 文字確定                     | IText editing exit → `State.handleTextEditingExited` | N×`objectCreated` を compound                            |
| アウトライン / 削除 / 複製   | `usecases/menu/*`                                    | State 高レベル method 内で compound push                 |
| 全選択 / Copy                | `usecases/menu/select-all` / `copy-selection-as-png` | history 対象外                                           |
| 保存 / 開く                  | `usecases/menu/file-io-interactor`                   | open 時に `state.applySnapshot` 内で `clearHistory`      |

すべて `state.pushCommand` 経由の単一経路。

### IText 編集中の特殊扱い

- 編集中 (`active.isEditing === true`) は `KeyboardController` の global Cmd+Z handler で **bypass**
- 編集 commit → `State.handleTextEditingExited` 内で N×`objectCreated` を 1 個の compound として push
- IText 自体は履歴対象外 (ephemeral): undo すると「commit 直前」 = 「これらの char が無い状態」に戻る
- 編集中の文字単位 undo は実装しない (fabric.IText 内蔵 undo は無い)

### ID と type の分離

`ObjectId` は **pure ULID** (branded string)、type 情報は `data.type` に分離。`ensureObjectId(obj, type)` で ID 発行と同時に `data.type` 確定、以後 immutable。type が変わる操作は新規 ID 発行。実装は `core/object-id.ts` の `monotonicFactory` (drag finalize や複製で同 ms に複数発行されるため monotonic 必須)。

### `History` のデータ構造

固定長 ring buffer + 論理 cursor。push 時に redo 列を切り捨て、上限超過は head ローテーションで O(1)。履歴上限はハードコード `max: 100`。実装 `core/history/history.ts`、テスト `test/history.test.ts`。

## 永続化 (.mply)

拡張子 `.mply`、形式:

```jsonc
{ "format": "mojiplay", "version": 1, "canvas": /* canvas.toJSON(['data']) */ }
```

`State.toSnapshot()` / `State.applySnapshot(s)`。`applySnapshot` は内部で `canvas.clear()` → `loadFromJSON` (async) → viewport reset → `clearHistory()` の順で完了まで Promise が resolve しない (必ず await)。

### 落とし穴

**1. `savedToken` capture timing**: IPC `await` の **前** に capture (snapshot と同 sync block で固定):

```ts
const tokenAtSnapshot = state.getHistoryToken(); // ← sync 内で固定
const snapshot = state.toSnapshot();
const result = await repo.save(snapshot, currentPath);
if (!result.ok) return false;
this.savedToken = tokenAtSnapshot; // ← 再取得しない
```

await 中の編集を dirty として残すため。

**2. atomic write**: `save-mply` IPC handler は **必ず tmp + rename**:

```ts
fs.writeFileSync(tmpPath, json, 'utf-8');
fs.renameSync(tmpPath, filePath);
```

直接 `writeFileSync(filePath, ...)` だと書き込み中のクラッシュ等で旧ファイルが破壊される。POSIX `rename(2)` / Windows `MoveFileEx` は atomic。

**3. close guard**: `win.on('close')` は同期で `e.preventDefault()` が必要なため 2 段階フロー: main 側 `isDirty` 保持 → close 時 renderer に IPC `app-close-request` → renderer 決断 (`destroy` / `cancel`) を `respondAppClose` で返す。

### dirty tracking (opaque token 方式)

State に `getHistoryToken(): number` (`pushCommand` / `undo` / `redo` / `clearHistory` / `applySnapshot` で increment)。FileIOInteractor が `savedToken` を field で保持、save 成功時に capture。dirty 判定は `state.getHistoryToken() !== savedToken`。`State.onMutate(cb)` で mutation 通知購読、UI title bar の `●` マークと main process への dirty 通知に使う。

## テスト

Jest + ts-jest、`test/` 配下。

### テスト戦略

**Pure data (core/ + Interface Adapter)** は fabric / DOM 抜きで unit test (path/\*, object-id, history, outline-position, path-adapter, copy-export)。

**Tool / Interactor / State business method** は **real `class State` + fabric の最小 stub** で test:

- `test/fabric-stub.ts` — fabric の最小 stub (Canvas / Path / Text / IText / ActiveSelection)。`installFabricStub()` で `globalThis.fabric` & `window` stub を install
- 各テストは `new State(new FakeFabricCanvas() as never)` で real State を構築、fixture 投入は `state.applySnapshot()` 経由
- assertion は **State の public API のみ** 経由 (`getActivePath().snapshot()` / `linearizeHistory()` / `toSnapshot()` 等)。stub の internal field は peek しない
- `file-io-interactor.test.ts` / `menu-action-registry.test.ts` は real State + 外部 boundary (`FakeRepo` / `FakeUI` / `FakeHost`) の test double

**Controller は基本 test しない** (DOM event simulation の工数が見合わない)。例外: pure data 部分 (KeyboardController の binding テーブル等) は単体 test 可。

`tsconfig.test.json` に `lib: ["ES2022","DOM"]` / `types: [..., "fabric"]` / `allowUmdGlobalAccess: true` / `src/globals/` の include。`renderer/outline-conversion` は top-level で `document.getElementById` を呼ぶので test 側で `jest.mock` で stub。

## 新しいコードを書く時のガイドライン

### CA 層を意識する

- **`core/`**: pure function + value object + 抽象 interface。DOM/fabric/Electron 不知
- **`usecases/`**: アプリ固有 orchestration。state または external dep があれば class + DI (例: `FileIOInteractor`)、stateless なら free function (例: `selectAll(state)`)。Output Port (環境差分のある副作用 IF) は `usecases/` 直下 (`ui-port-interface.ts`, `host-shell-interface.ts`)
- **`repository/`**: 永続化 port + concrete を併置
- **`controllers/`**: Input Adapter。fabric/DOM 直接 OK だが business logic は書かず State / Use Case に dispatch。`xxx-interface.ts` + `xxx.ts` の 2 ファイル組
- **`renderer/`**: 副作用あり (DOM/fabric/Electron)。State concrete、Output Port concrete、Presenter helper、entry (app.ts = DI 容器)
- **`globals/`**: 外部世界の ambient `.d.ts` のみ

### 既存の癒着を新規に増やさない

- 新しい tool / use case に fabric / DOM / Electron を直接 import しない (= State / Port 経由)
- `controllers/` では fabric/DOM 直接 OK だが business logic を書かず State / Use Case に dispatch
- `*Controller` を Use Case の suffix に使わない (Controller は `controllers/` のみ)
- `active.type === 'activeSelection'` のような fabric 文字列タグ依存を新規には書かない (= `state.getActiveObjects().length` で判定)
- `window.electronAPI` 直叩きを新規に書かない (= HostShell port 経由)

### pure helper を core に動かすかの判定

「全 pure 関数は core にあるべき」ではない。renderer / tools 内の pure helper を core/ に動かす実利は以下 3 点で判定:

1. 多層から import されているか (= dependency 圧)
2. 単独でテスト書きたい domain knowledge か (= 罠 / 仕様の塊)
3. コードベース読んだ時「これ core じゃね?」と迷うか (= 認知負荷)

全部 No なら据え置き。dependency rule 違反 (例: core から fabric を触る) なら問答無用で動かす。

### 新機能への指針

- 移動 / 選択 / スナップは `fabric.Text` 特有フィールドではなく **汎用プロパティ** (`target.left`, `target.top`, `target.angle`) に対して書く
- `data` にテキスト専用フィールドを足さない
- Illustrator / Photoshop / Figma の UX 慣習を優先 (例: Alt で一時制約解除、Cmd+Shift+O でアウトライン化)

### Selection 抽象化への配慮 (将来の方向)

camera 層の selection は現状 fabric の生 active object に散らばっている。将来 `Selection` (kind: `'objects' | 'anchors' | 'handles' | 'none'`、ID ベース) として一級概念に整理予定。**複数アンカー同時選択** を本格的にやる手前が自然な着手タイミング。それまでは:

- 新しい選択経路を追加するなら **State 経由を徹底**、fabric API 直叩きを増やさない
- Command は ID ベース維持 (`fabric.Object` 参照ではなく `ObjectId`)
- undo/redo は selection を能動的に切り替えない (camera 層は履歴対象外)

## 実装済 / 今後実装予定

**実装済**: アウトライン化 + アンカー / ハンドル編集、アンカー追加 / 削除 (pen)、Undo/Redo + state-jump、保存 / 開く (`.mply` + atomic write + dirty tracking + close guard)、Controller 5 分割、HostShell port、MenuAction registry

**今後**: bbox 再計算改善 (`pathOffset` 補正の精緻化)、複数アンカー同時選択 (= Selection 抽象化と同時着手予定)、スムーズ / コーナーアンカー変換、アンカードラッグ時のグリッドスナップ、keyboard binding の JSON 化 (= Use Case Resolver + Gateway)

## UI 言語

ツールバーラベル / ツールチップ / トーストは**日本語**。新規ユーザー向け文字列も日本語維持。

## 外部リソース

mojiplay の Trello Wiki カードは **https://trello.com/c/lQu6eVB3** (これ 1 つだけ)。「Trello 更新して」「Wiki 書き直して」等の依頼を受けたら、必ずこのカードを編集すること。

**注意**:

- `mcp__claude_ai_Trello_Discussion_Log__list_recent_discussions` で `mojiplay:` で始まる他のカードが見つかっても **Wiki と勘違いしない**こと。それらは過去議論ログ (snapshot)。Wiki 用の更新は上記 1 つの正カードに集約
- Trello MCP には card archive / delete API は無い。誤って書き換え / 新規作成した場合は **ユーザに Trello UI 上で archive を依頼する**しかない
