# CLAUDE.md

このファイルは、Claude Code がこのリポジトリのコードを扱う際のガイドラインを提供します。

## このプロジェクトの最終目標

- パスを生成 (ベジェ曲線) してフォントの形を少しいじったりしてロゴにしたい
- フォトショやイラストレータの「アウトライン作成」相当: テキストをアウトライン化してパスにしてから形をいじる

## コマンド

- `npm start` — ビルド + Electron 起動
- `npm run build` — main + renderer ビルド (起動なし)
- `npm test` — Jest (ts-jest 経由)
- `npm run lint` / `format` / `format:check` — ESLint / Prettier
- `npm run dist:win` / `pack` — Windows portable / unpacked

### push 前のチェック (必須)

`git push` する前に**必ず以下 4 コマンドが全て pass**:

```
npm run build && npm test && npm run lint && npm run format:check
```

1 工程パスしたから次もパスではない。前工程の修正で後工程が落ちる場合あり。最終的に 4 つを連続で通すこと。

## ディレクトリ構成 (process / context × CA 階層)

top-level は **runtime context (どの process / world で動くか)** で 3 分割:

- `host/` — main process (Node、OS 特権)
- `preload.ts` — renderer process / isolated world (Chromium-side bridge)
- `window/` — renderer process / main world (アプリ本体、CA レイヤ全部入り)

`electron-ipc.ts` と `globals/` は pure type で runtime context 不知 (共有契約)。

```
src/
├── host/                        # MAIN PROCESS (Node)
│   ├── main.ts                  # entry: BrowserWindow / app lifecycle / close guard
│   └── ipc.ts                   # ipcMain.handle x16 を集約 (IPC 入口)
├── preload.ts                   # RENDERER / isolated world (contextBridge + ipcRenderer.invoke = IPC 出口)
├── window/                      # RENDERER / main world (アプリ本体)
│   ├── renderer.ts              # entry / Composition Root (DI のみ)
│   ├── core/                    # Entities: path/ history/ document/ state-interface.ts / object-id.ts
│   ├── usecases/                # Use Case (Interactor + Port): tools/ menu/ ui-port-interface.ts / host-shell-interface.ts / canvas-port-interface.ts
│   ├── repository/              # Gateway: document-interface.ts + file-system-document.ts
│   ├── controllers/             # Input Adapter (外→内): canvas-input / keyboard / menu / toolbar / view
│   ├── presenter/               # Presenter + Frameworks 接触面 (内→外、fabric/DOM 癒着レイヤ)
│   └── menu-action-registry.ts  # Composition Wiring: id → use case dispatch table
├── electron-ipc.ts              # IPC 契約 (ElectronIPC interface + Ipc* result types)
└── globals/                     # ambient .d.ts (Window 拡張、fabric/fontkit 補完)
```

| dir / file            | runtime context             | CA 用語                          |
| --------------------- | --------------------------- | -------------------------------- |
| `host/`               | main (Node)                 | Frameworks & Drivers             |
| `preload.ts`          | renderer / isolated world   | Frameworks & Drivers (bridge)    |
| `window/core/`        | renderer / main world       | Entities                         |
| `window/usecases/`    | renderer / main world       | Use Case (Interactor + Port)     |
| `window/repository/`  | renderer / main world       | Interface Adapter (Gateway)      |
| `window/controllers/` | renderer / main world       | Interface Adapter (Input、外→内) |
| `window/presenter/`   | renderer / main world       | Presenter + 接触面 (内→外)       |
| `window/renderer.ts`  | renderer / main world       | Composition Root                 |
| `electron-ipc.ts`     | (型のみ、両 process が共有) | shared contract                  |

**用語衝突回避**: Electron の "renderer process" は Chromium で動くプロセス全体 (preload + window/)。CA の "Presenter" は `window/presenter/`。両者を区別するために CA Presenter を旧 `src/renderer/` から `window/presenter/` にリネーム。

**依存方向**: 内側 → 外側を禁止。Controller (外→内) と Presenter (内→外) は方向が逆な別概念。

### 命名規約

- interface 定義のみ → `*-interface.ts` (例: `state-interface.ts`)。実装 (class / factory) → ベース名 (例: `state.ts`)
- interface ファイルに class / factory を混ぜない (test double が object literal で interface を満たすため。class 型は private field の nominal typing で satisfies 不可)
- ディレクトリ名で role が自明なら suffix 省略 (例: `controllers/canvas-input.ts` であって `canvas-input-controller.ts` ではない)
- Tool = `*Tool` / Stateful Use Case = `*Interactor` / Stateless = free function / Controller = `*Controller` (controllers/ のみ)
- interface ↔ class ペア: `XxxController` (interface) + `XxxControllerImpl` (class)

## ビルド構成 (tsc + esbuild)

`npm run build` の 3 段階:

1. `tsc -p tsconfig.main.json` → host/ + preload + electron-ipc を `dist/host/{main,ipc}.js` / `dist/{preload,electron-ipc}.js` (CommonJS)
2. `tsc -p tsconfig.renderer.json` (noEmit) → `src/window/**` の typecheck (esnext / DOM lib / `types: ["fabric"]`)
3. `node esbuild.renderer.mjs` → `src/window/renderer.ts` entry で `dist/renderer/bundle.js` (IIFE)

`public/index.html` は 3 つの `<script>` のみ: `vendor/fabric.min.js` / `vendor/fontkit.js` / `dist/renderer/bundle.js`。fabric / fontkit は UMD グローバル、`allowUmdGlobalAccess: true` で import 無し参照可。

### tsconfig 4 種

- `tsconfig.main.json` — `build:main` 用。`src/host/`, `src/preload.ts`, `src/electron-ipc.ts` を CommonJS emit
- `tsconfig.renderer.json` — `build:typecheck` 用。`src/window/**` noEmit
- `tsconfig.test.json` — jest (ts-jest) 用。`test/` + globals
- `tsconfig.json` (root) — **IDE 専用**。`src/**` + `test/**` 広く include、`noEmit: true`。WebStorm / VS Code が globals を確実に読ませるため

`src/globals/*.d.ts` は全て module-mode (`declare global { ... } export {};`) で書く。script-mode の `interface Window {...}` や `declare namespace fontkit` は一部 IDE の TS service がファイル discovery タイミング次第で読み込み損なうため避ける。

## アーキテクチャ

### Electron 3 プロセス / IPC 境界

renderer 側コードは `window.electronIPC.X()` を呼ぶだけ。channel 名文字列は preload と host/ipc.ts でのみ言及。

| 役割                                             | 場所                  | runtime context           |
| ------------------------------------------------ | --------------------- | ------------------------- |
| **契約** (channel 名 / 引数 / 戻り値の型)        | `src/electron-ipc.ts` | (型のみ)                  |
| **出口** (renderer → main、`ipcRenderer.invoke`) | `src/preload.ts`      | renderer / isolated world |
| **入口** (main 側、`ipcMain.handle` x16)         | `src/host/ipc.ts`     | main (Node)               |

preload は `const api: ElectronIPC = {...}` で型強制 → 契約とずれたら即コンパイルエラー。`Ipc*` prefix は core/document の domain `SaveResult` と name conflict 回避用。

`host/ipc.ts` は close guard 用の `isDirty` / `allowClose` 状態も保持し、`isCloseBlocked()` で `host/main.ts` の `wireCloseGuard` に露出。

### 5 Controllers (`window/controllers/`)

| Controller              | 入力                                                  | dispatch 先                                          |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `CanvasInputController` | DOM mousedown/move + fabric mouse/selection/object 系 | Tool, Alt+wheel zoom, anchor overlay, toolbar 同期   |
| `KeyboardController`    | document keydown                                      | MenuAction, Tool command, Enter で IText commit      |
| `MenuController`        | HTML メニューバー click + `host.onCopyRequest`        | MenuAction                                           |
| `ToolbarController`     | toolbar input/button + mode buttons                   | `state.applyPropsToSelection` / MenuAction / setMode |
| `ViewController`        | window resize / close guard / docStatus               | canvas resize / title bar / close guard              |

各 Controller は `xxx-interface.ts` + `xxx.ts` の 2 ファイル組。consumer は interface 側に依存。`attach()` / `detach()` は self-wiring。

### 文字モデル (コードからは見えにくい)

ユーザーが `fabric.IText` 編集を完了すると、`State.handleTextEditingExited` (`text:editing:exited` hook) が **1 文字ごとの `fabric.Text` オブジェクト**に分割。各文字は `data: { groupId, charIndex, sourceText }` を保持、同じ IText から生成された文字は同じ `groupId`。文字間隔は fabric の `__charBounds` 内部測定でペアワイズカーニング保持。「単語」は `groupId` でリンクされた N 個の独立 fabric.Object。

### 5 モード (`state.getCurrentMode()`)

- `select-group` (黒矢印) — 1 文字クリックで同 groupId 全体に展開
- `select-char` (白矢印) — 文字単位選択 + グリッドスナップ (Alt で一時無効) + アウトライン化済 path のアンカー / ハンドル編集
- `text` — 空き領域クリックで IText 生成 (このモード中は既存 obj の selectable/evented を false に)
- `pen-add` / `pen-remove` — アウトライン化済 path のアンカー追加 / 削除

`state.setMode()` は全 obj の selectable/evented を切り替える。

### 重要な振る舞い

- **Enter 確定フロー**: KeyboardController capture phase で IText 編集中 Enter を `exitEditing()` に。実 commit は `text:editing:exited` (Esc / 枠外クリックでも発火) 経由で 1 か所処理。コミットロジックを keydown ハンドラに書かないこと
- **アウトライン化 (Cmd+Shift+O)**: fontkit でグリフパス取得 → SVG `d` → `fabric.Path`、`data.outlined: true` を付け groupId 引き継ぎ
- **アンカー編集**: `data.outlined === true` のパス選択時に `contextTop` にマーカー描画。DOM capture phase の mousedown で fabric より先にアンカーヒットテスト、ヒット時 `stopImmediatePropagation` でパス全体 drag 抑止
- **DPI**: `contextTop` 描画時は `canvas.getRetinaScaling()` で setTransform
- **クリップボードコピー**: 選択 obj を 10 倍解像度 PNG → IPC `copy-image` → main の `clipboard.writeImage`
- **`toCanvasElement` 落とし穴**: object-level は `{ multiplier: 10 }` オブジェクトで呼ぶ (canvas-level の `(10)` と signature 違う)

## State / Viewport 分離 (Undo/Redo + 永続化の基盤)

- **State (ドキュメント層)** = 全 object の `commands` / 位置 / scale / 回転 / fill / fontFamily 等。**履歴 / 永続化対象**
- **Camera 層** = viewportTransform / selection / tool mode / IText 編集中。**履歴 / 永続化対象外** (ephemeral)

### state-jump semantic

undo/redo は `ObjectSnapshot` (= `fabric.Object.toObject(['data'])`) を canvas に丸ごと書き戻すだけ。差分計算 / 位置補正のような fabric 座標モデル依存の数学を持たない。`pathOffset` / `width` / `height` は `commands` から `_setPositionDimensions` で決定論的に再算出。

### Command ADT (`core/history/types.ts`)

`objectChanged` / `objectCreated` / `objectDeleted` / `compound`。すべて `state.pushCommand` の単一経路。

### 設計の落とし穴

- **state-jump 一貫採用**: 差分 / 位置補正ロジックを持たない
- **`ObjectSnapshot` = `toObject(['data'])`**: 永続化フォーマットと自動一致 (format 変換不要)
- **`History` は fabric 不知**: pure data 責務。fabric への反映は `CanvasPort` (`usecases/canvas-port-interface.ts`、不透明 snapshot の canvas 読み書き口) 経由で `presenter/fabric-canvas-port.ts` が担う
- **`presenter/state.ts` は Presenter ではなく canvas Gateway**: presenter/ 配下だが役割は fabric 接触面 (双方向)。業務判断は触るたびに usecase 側 (pure function / port 経由) へくり抜いていく方針
- **type が変わる操作は新規 ID 発行**: outline 化 (Text→Path) は `objectDeleted`+`objectCreated` の compound
- **`e.action` の有無で fabric-driven / tool-driven を区別**: `object:modified` の二重 push 防止
- **path 書き戻しの `path` 配列は `set()` 経由ではなく直接代入**: fabric 内部正規化を回避
- **before/after no-op skip**: `JSON.stringify` 同値なら push しない
- **canonical handle**: 同じ `fabric.Object` には同じ `ObjectHandle` instance (WeakMap)。`SelectGroupTool` の `alreadyExpanded` は identity (`===`) に依存
- **IText 編集中**: 編集 commit → N×`objectCreated` を 1 個の compound として push。編集中の文字単位 undo は無い
- **`ObjectId` は pure ULID** (branded string)、type 情報は `data.type` に分離。`monotonicFactory` (同 ms 内に複数発行されるため必須)
- **`History` データ構造**: 固定長 ring buffer + 論理 cursor、上限 100

## 永続化 (.mply)

形式: `{ "format": "mojiplay", "version": 1, "canvas": canvas.toJSON(['data']) }`

`State.toSnapshot()` / `State.applySnapshot(s)`。`applySnapshot` は `canvas.clear()` → `loadFromJSON` (async) → viewport reset → `clearHistory()` の順 (必ず await)。

### 落とし穴

- **`savedToken` capture timing**: IPC `await` の **前** に capture (sync block 内で固定)。await 中の編集を dirty として残すため
- **atomic write**: `save-mply` IPC handler は **必ず tmp + rename**。直接 `writeFileSync(filePath, ...)` は禁止 (書き込み中のクラッシュで旧ファイル破壊)
- **close guard**: `win.on('close')` は同期で `preventDefault()` 必須なため 2 段階 IPC: main 側 dirty 保持 → close 時 renderer に `app-close-request` → renderer 決断 (`destroy`/`cancel`) を `respondAppClose` で返す
- **dirty tracking**: opaque token (`State.getHistoryToken()`, `pushCommand` 等で increment)。FileIOInteractor が `savedToken` を保持、`state.getHistoryToken() !== savedToken` で dirty 判定

## テスト

Jest + ts-jest、`test/` 配下。

- **Pure data** (core/ + Adapter) は fabric / DOM 抜きで unit test
- **Tool / Interactor / State business method** は **real `class State` + fabric 最小 stub** (`test/fabric-stub.ts`、`installFabricStub()`) で test。fixture 投入は `state.applySnapshot()` 経由、assertion は State の public API のみ (stub の internal field は peek しない)
- **Controller は基本 test しない** (DOM event simulation コスト見合わず)
- `presenter/outline-conversion` は top-level で `document.getElementById` を呼ぶので test 側で `jest.mock` で stub

## 新規コード ガイドライン

- 新しい tool / use case に fabric / DOM / Electron を直接 import しない (= State / Port 経由)
- `window/controllers/` では fabric/DOM 直接 OK だが business logic は書かず State / Use Case に dispatch
- `window.electronIPC` 直叩きを新規に書かない (= HostShell port 経由)。`window.electronIPC` を触っていいのは `presenter/electron-host-shell.ts` / `presenter/ui-port-impl.ts` / `presenter/logger.ts` / `repository/file-system-document.ts` の 4 ファイルのみ
- 移動 / 選択 / スナップは `fabric.Text` 特有フィールドではなく汎用プロパティ (`target.left/top/angle`) に対して書く
- `data` にテキスト専用フィールドを足さない
- UX 慣習は Illustrator / Photoshop / Figma に倣う (Alt で一時制約解除、Cmd+Shift+O でアウトライン化など)
- `active.type === 'activeSelection'` 等の fabric 文字列タグ依存を新規に書かない (= `state.getActiveObjects().length` で判定)

## UI 言語

ツールバーラベル / ツールチップ / トーストは**日本語**。新規ユーザー向け文字列も日本語維持。

## 外部リソース

mojiplay の Trello Wiki カードは **https://trello.com/c/lQu6eVB3** (これ 1 つだけ)。「Trello 更新して」「Wiki 書き直して」の依頼は必ずこのカードを編集。

- `mcp__claude_ai_Trello_Discussion_Log__list_recent_discussions` で `mojiplay:` で始まる他カードが見つかっても **Wiki と勘違いしない**こと (過去議論ログ snapshot)
- Trello MCP に archive / delete API は無い。誤って書き換え / 新規作成した場合は **ユーザに Trello UI 上で archive を依頼する**
