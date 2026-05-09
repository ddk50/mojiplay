# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリのコードを扱う際のガイドラインを提供します。

## このプロジェクトの最終目標

設計するときに留意せよ:

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
│   ├── state.ts          # State interface (= 抽象契約)
│   └── object-id.ts      # ObjectId (ULID branded) / ensureObjectId
├── usecases/             # Use Case (Interactor + Output Port)
│   ├── tools/            # PointerInput-driven (黒/白矢印, ペン±, 文字)
│   ├── menu/             # Menu/keyboard-triggered (incl. file-io-interactor)
│   └── ui-port.ts        # Output Port (toast / dialog / IPC 抽象)
├── repository/           # Driven adapter (port + concrete を sibling 配置)
├── renderer/             # Presenter + Frameworks 接触面
│   ├── state.ts          # State concrete impl (fabric.Canvas を encapsulate)
│   ├── ui-port-impl.ts   # ElectronUIPort
│   ├── app.ts            # entry + DOM event dispatcher (= CA Controller)
│   └── ...               # logger, toast, copy-export, outline-conversion 等
└── globals/              # ambient .d.ts (Window 拡張)
```

| dir | CA 用語 | fabric/DOM/Electron |
|---|---|---|
| `core/` | Entities | 不知 (何も import しない) |
| `usecases/` | Use Case (Interactor + Port) | 不知 (core / repository(port) のみ) |
| `repository/` | Driven adapter for storage | core のみ依存 |
| `renderer/` | Presenter + Frameworks | 全レイヤ可 |
| `main.ts` / `preload.ts` | Frameworks & Drivers | Electron main / IPC |

**依存方向 (CA dependency rule)**: 内側 → 外側を禁止。

**Naming**:
- Tool-driven Use Case = `*Tool` (例: `SelectCharTool`)
- Stateful menu Use Case = `*Interactor` (例: `FileIOInteractor`)
- Stateless menu Use Case = free function (例: `selectAll(state)`、`deleteSelection(state)`)
- `*Controller` は CA で input adapter のみ (= `app.ts` の DOM event dispatcher)。Use Case には付けない

## ビルド構成 (tsc + esbuild)

`npm run build` の 3 段階:

1. `tsc -p tsconfig.json` → main + preload を `dist/{main,preload}.js` (CommonJS, Node API)
2. `tsc -p tsconfig.renderer.json` (noEmit) → core/usecases/repository/renderer の typecheck
3. `node esbuild.renderer.mjs` → renderer 全体を `dist/renderer/bundle.js` (IIFE)

`renderer/index.html` は 3 つの `<script>` のみ: `vendor/fabric.min.js` / `vendor/fontkit.js` / `dist/renderer/bundle.js`。fabric / fontkit は UMD グローバルとして runtime 解決、`tsconfig.renderer.json` の `allowUmdGlobalAccess: true` で `import` 文無しで参照可能。fontkit の global 型は `src/globals/fontkit.d.ts`。

新規 ts ファイル追加時は `tsconfig.renderer.json` の include グロブ (`src/{core,usecases,repository,renderer}/**/*.ts`) に該当することを確認するだけで esbuild が自動でバンドルする (= `renderer/index.html` 編集不要)。`src/globals/electron-api.d.ts` は両 tsconfig 共有で `window.electronAPI` を定義。

## アーキテクチャ

**Electron 3 プロセス:**

- `src/main.ts` — BrowserWindow (`contextIsolation: on`, `nodeIntegration: off`)。IPC: `save-png` / `copy-image` / `log` / `toggle-devtools` / view 系 / `save-mply` (atomic write) / `open-mply` / `confirm-discard` / `app-close-request`。ネイティブメニューは `Menu.setApplicationMenu(null)` で無効化 (HTML メニューバーを使用)
- `src/preload.ts` — `contextBridge` で `window.electronAPI` 公開
- `src/renderer/app.ts` — entry。UI state (mode/selection)、DOM 入力 dispatcher、Use Case 配線 (`new FileIOInteractor(state, repo, ui)` / 各 tool / `handleMenuAction`)。fabric の操作は `state` instance 経由

**文字モデル (重要 — コードからは分かりにくい):**

ユーザーが `fabric.IText` の入力を完了すると、`commitIText()` が**1 文字ごとの `fabric.Text` オブジェクト**に分割。各文字は `data: { groupId, charIndex, sourceText }` を保持し、同じ IText から生成された文字は同じ `groupId` を共有。文字間隔は fabric ではなくオフスクリーンキャンバスの `measureText` で計算する。

これがコアデータモデル: 「単語」は `data.groupId` でリンクされた N 個の独立した fabric.Object。単語単位で扱う機能は `canvas.getObjects()` を `groupId` でフィルタする。

**3 モード** (`currentMode`):

- `select-group` (黒矢印) — 1 文字クリックで同 `groupId` 全体に展開 (`SelectGroupTool`)
- `select-char` (白矢印) — 文字単位選択。グリッドスナップ (Alt で一時無効、Illustrator 風)。アウトライン化済パスのアンカー / ハンドル編集
- `text` — 空き領域クリックで `IText` 生成。このモード中は既存 obj の `selectable` / `evented` を false に

`setMode()` は全 obj の `selectable`/`evented` を切り替える。新 object type を足す時はこのループとの整合性に注意。

**Enter 確定フロー**: capture phase の `document.addEventListener('keydown', ..., true)` が IText 編集中の Enter を遮断して `exitEditing()`。実際の commit は `text:editing:exited` (Esc / 枠外クリックでも発火) に集約。**コミットロジックを keydown ハンドラに移さないこと** (Enter / Esc / クリックアウェイの 3 経路を 1 か所で扱うため)。

**アウトライン化 (Cmd/Ctrl+Shift+O)**: `outlineTextToPath()` が fontkit でグリフパスを取得 → SVG `d` → `fabric.Path` を生成。`data: { ...origData, outlined: true }` を付け、`groupId` を引き継ぐ。

**アンカー編集 (白矢印モード)**: `data.outlined === true` なパスが選択されると `contextTop` にアンカーマーカー描画。DOM capture phase の `mousedown` で fabric より先にアンカーヒットテスト → ヒット時 `stopImmediatePropagation` でパス全体ドラッグを抑止。drag 完了で `_setPositionDimensions` で bbox 再計算、`pathOffset` 変化分を `left`/`top` に補正して視覚位置を維持。

**DPI スケーリング**: `contextTop` 描画時は `canvas.getRetinaScaling()` を掛ける (`setTransform(retina,0,0,retina,0,0)`、`setTransform(1,0,0,1,0,0)` ではない)。

**クリップボードコピー (Ctrl+C)**: 選択 obj を `exportObjectToPngDataUrl()` (`renderer/copy-export.ts`) で 10 倍解像度 PNG → IPC `copy-image` → main の `clipboard.writeImage`。

**重要な落とし穴**: `fabric.Object.prototype.toCanvasElement(options)` は **options オブジェクト** (`{ multiplier: 10 }`) で呼ぶ。`toCanvasElement(10)` だと `options.multiplier` が undefined になり 1 倍でレンダリングされる (Canvas-level の同名メソッドは positional arg だが Object-level は違う)。`copy-export.ts` の typed wrapper で型安全に防止済。

**ズーム**: Alt + ホイールで `canvas.zoomToPoint`、範囲 `[0.1, 20]` (Photoshop 風)。

## State / Viewport 分離モデル (= Undo/Redo + 永続化の基盤)

mojiplay の状態は 2 層:

- **State (ドキュメント層)** = 全 object の `commands` / `left,top,scaleX,scaleY,angle` / `fill` / `fontFamily` 等。fabric では `canvas.getObjects()` の各 `fabric.Object`。**履歴 / 永続化対象**
- **Camera 層** = viewport (`canvas.viewportTransform`) / selection (どれが active か) / tool mode / IText 編集中 state。**履歴 / 永続化対象外** (ephemeral)

レンダリング時に viewport を適用して画面を作る。fabric は最初からこの 2 層を分離している (`canvas.objects` vs `canvas.viewportTransform`)。3D ソフト (Blender 等) / CAD / Figma などと同じ model。

### state-jump semantic

undo/redo は `ObjectSnapshot` (= `fabric.Object.toObject(['data'])` 出力) を canvas に丸ごと書き戻すだけ。差分計算 / 位置補正のような fabric 座標モデル依存の数学を持たない。

なぜ書き戻しだけで足りるか: 任意の path の視覚位置は

```
bboxCenterWorld = (left, top) + R(angle) · diag(scaleX, scaleY) · pathOffset
```

で完全に決まり、`pathOffset` / `width` / `height` は `commands` から `_setPositionDimensions` で決定論的に再算出できる。snapshot として持つべき独立 state は `{ commands, left, top, scaleX, scaleY, angle, fill, ... }` だけで、これを書き戻せば視覚位置は一意に再現する。

### Command ADT (`core/history/types.ts`)

```ts
type Command =
  | { kind: 'objectChanged'; objectId: ObjectId; before: ObjectSnapshot; after: ObjectSnapshot }
  | { kind: 'objectCreated'; objectId: ObjectId; after:  ObjectSnapshot }
  | { kind: 'objectDeleted'; objectId: ObjectId; before: ObjectSnapshot }
  | { kind: 'compound';      commands: ReadonlyArray<Command> };
```

履歴対象 = state を変える全操作: アンカー / ハンドル編集 (`select-char-tool`)、アンカー追加 / 削除 (`pen-add-tool` / `pen-remove-tool`)、object 移動 / 拡縮 / 回転 (app.ts の `mouse:down` + `object:modified` hook)、toolbar property 変更 (`applyToSelection`)、文字確定 (`commitIText` の N×`objectCreated` を `compound`)、アウトライン化 (`compound` of N×(`objectDeleted` Text + `objectCreated` Path))、削除 / 複製。

履歴対象外 = camera 層 (viewport zoom/pan、selection、tool mode、IText 編集中の文字入力。commit 1 回で 1 step として履歴に乗る)。

### 重要な設計ポイント (落とし穴含む)

1. **state-jump 一貫採用**: undo/redo は snapshot を丸ごと書き戻し。差分 / 位置補正ロジックを持たない
2. **State (= canvas.objects) と Camera (= viewportTransform 他) を物理的に分離**: history も persistence も state のみが対象
3. **`ObjectSnapshot` は `fabric.Object.toObject(['data'])` 出力**: 永続化フォーマットと自動一致 (format 変換不要)
4. **`History` は fabric を知らない**: pure data 責務。fabric への反映は `renderer/state.ts` 内 private な `applyCommand` / `revertCommand` が担当
5. **`compound` は逆順 revert**: `[a, b, c]` apply の打ち消しは `[c, b, a]` の順で各々 revert
6. **type が変わる操作は新規 ID を発行**: outline 化 (Text→Path) は同一 identity を維持せず、`objectDeleted`(Text) + `objectCreated`(Path) の compound として扱う
7. **`e.action` の有無で fabric-driven / tool-driven を区別**: `object:modified` には 2 経路あり。fabric-driven (黒矢印 drag/scale/rotate) は `e.action` あり、tool-driven (`finalizeDrag` 内 `canvas.fire('object:modified', { target: p })`) は `e.action` 無し。app.ts の hook は `e.action` 無しを skip して二重 push を防ぐ (= tool 自身が既に `pushCommand` 済み)
8. **path 書き戻しの `path` 配列は `set()` 経由ではなく直接代入**: fabric 内部正規化を回避し、`_setPositionDimensions` で派生値再算出経路を確実に通す
9. **before/after の no-op skip**: tool 経路で drag 終了時、`JSON.stringify(before) === JSON.stringify(after)` なら push しない (= 0-delta drag は履歴に乗らない)
10. **canonical handle**: `getActiveObjects()` / `getAllObjects()` は同じ underlying `fabric.Object` には同じ `ObjectHandle` instance を返す (WeakMap キャッシュ)。`SelectGroupTool` の `alreadyExpanded` 判定は identity (`===`) に依存するため、これを破ると selection event 再発火で無限再帰し fabric の drag state が破壊される

### Tool / Use Case の責任分担

| 操作 | 起点 | history push |
|---|---|---|
| アンカー / ハンドル drag | `tools/select-char-tool` | `pointerUp` で tool 自身が push |
| アンカー追加 / 削除 | `tools/pen-add-tool` / `pen-remove-tool` | tool 自身が push |
| object 移動 / scale / rotate | fabric の自然挙動 | `app.ts` の `object:modified` hook で `e.action` 判別して push |
| toolbar property 変更 | `applyToSelection` (app.ts) | 同上 (before/after capture) |
| 文字確定 (commitIText) | `commitIText` (app.ts) | N×`objectCreated` を compound |
| アウトライン / 削除 / 複製 | `usecases/menu/*` | State 高レベル method 内で compound push |
| 全選択 / Copy | `usecases/menu/select-all` / `copy-selection-as-png` | history 対象外 |
| 保存 / 開く | `usecases/menu/file-io-interactor` | open 時に `state.applySnapshot` 内で `clearHistory` |

すべて `state.pushCommand` 経由の単一経路。

### IText 編集中の特殊扱い

- IText 編集中 (`active.isEditing === true`) は global Cmd+Z handler で **bypass** (= 何もしない)
- 編集 commit (Enter / Esc / クリックアウェイ) → `commitIText` 内で N×`objectCreated` を 1 個の compound Command として push
- IText 自体は履歴対象外 (ephemeral): `objectDeleted` を積まない。undo すると「commit 直前」 = 「これらの char が無い状態」に戻る
- 編集中の文字単位 undo は実装しない (fabric.IText は内蔵 undo を持たない、ユーザーは backspace 等で対処)

### ID と type の分離

`ObjectId` は **pure ULID** (branded string)、type 情報は `data.type` に分離。両者を ID 文字列に混在させない (= ULID の lexicographic sort 性質保持、単一責任)。`ensureObjectId(obj, type)` で ID 発行と同時に `data.type` 確定、以後 immutable。type が変わる操作は新規 ID 発行 (上述 #6)。実装は `core/object-id.ts` の `monotonicFactory` (= drag finalize や複製で同 ms に複数発行されるため monotonic 必須)。

### `History` のデータ構造

固定長 ring buffer (`Command[max]`) + 論理 cursor。push 時に redo 列を切り捨て、上限超過は head ローテーションで O(1) で古い側を捨てる。実装 `core/history/history.ts`、テスト `test/history.test.ts` (12 cases、wrap-around / overflow / undo→redo / edge case 含む)。履歴上限はハードコード `max: 100`。

### 設計ファイル参照

- `core/state.ts` — State interface (抽象契約)
- `renderer/state.ts` — 実装 (fabric.Canvas を encapsulate、private に snapshot 境界変換 + applyCommand/revertCommand + fabric event hook)
- `core/history/types.ts` / `history.ts` — Command ADT + ring buffer
- `core/object-id.ts` — ULID

## 永続化 (.mply)

拡張子 `.mply`、形式:

```jsonc
{
  "format": "mojiplay",   // 識別子 (異 format 弾き)
  "version": 1,           // 将来の migration hook
  "canvas": { /* canvas.toJSON(['data']) の出力 */ }
}
```

`State.toSnapshot()` 出力、`State.applySnapshot(s)` 取り込み。`applySnapshot` は内部で `canvas.clear()` → `loadFromJSON` (async) → viewport reset → `clearHistory()` の順で完了まで Promise が resolve しない (= 必ず await すること)。

### CA レイヤ配線

```
keydown (Cmd+S/O) → app.ts dispatcher → fileIO.saveCurrent/openFile()
                    └ FileIOInteractor (usecases/menu/, DI: state/repo/ui)
                         ├ state.toSnapshot/applySnapshot   (Presenter/Frameworks 接触は State 内)
                         ├ repo.save/load                    (Driven adapter)
                         └ ui.showToast/confirmDiscard/...   (Output Port)
                              └ ElectronUIPort / FileSystemDocumentRepository
                                   └ window.electronAPI.saveMply/openMply
                                        └ IPC → main.ts (atomic write)
```

`FileIOInteractor` は fabric / DOM / Electron 不知。`State` は real、`Repository` / `UIPort` は外部 boundary なので test 時に Fake を inject (= `test/file-io-interactor.test.ts`)。

### 落とし穴

**1. `savedToken` capture timing**: IPC `await` の **前** に capture (snapshot と同 sync block で固定)。await 後に再取得すると await 中の編集を見逃して dirty=false になる silent bug:

```ts
const tokenAtSnapshot = state.getHistoryToken();  // ← block A (sync)
const snapshot        = state.toSnapshot();
const result = await repo.save(snapshot, currentPath);  // ← await
if (!result.ok) return false;
this.savedToken = tokenAtSnapshot;  // ← block B、再取得しない
```

JS は single-thread なので block A 中はユーザ入力が割り込めず、snapshot と token は必ず一致した瞬間状態を捕まえられる。

**2. atomic write**: `save-mply` IPC handler は **必ず tmp + rename** で書き出す:

```ts
const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
fs.writeFileSync(tmpPath, json, 'utf-8');
fs.renameSync(tmpPath, filePath);
```

直接 `fs.writeFileSync(filePath, ...)` だと書き込み中のクラッシュ / 電源断 / disk full で既存ファイルが半端な状態で破壊される。POSIX `rename(2)` / Windows `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` は atomic = 旧ファイルか新ファイルのいずれかしか観測されない。失敗時は tmp を unlink で片付ける。

**3. close guard (unsaved changes 警告)**: `win.on('close')` は同期で `e.preventDefault()` が必要なため 2 段階フロー: main 側で `isDirty` 保持、close 時に renderer に IPC `app-close-request` → renderer が決断 (`destroy` / `cancel`) を `respondAppClose` で返す。詳細は `src/main.ts` の `wireCloseGuard`。

### dirty tracking (opaque token 方式)

State に `getHistoryToken(): number` (`pushCommand` / `undo` / `redo` / `clearHistory` / `applySnapshot` 末尾で increment)。FileIOInteractor が `savedToken` を field で持ち、save 成功時に capture。dirty 判定は `state.getHistoryToken() !== savedToken`。`State.onMutate(cb)` で mutation 通知購読、UI title bar の `●` マークと main process への dirty 通知に使う。

## テスト

Jest + ts-jest、テストファイルは `test/` 配下。

```bash
npm test              # 全テスト実行
npx jest --watch      # ウォッチモード
npx jest copy-export  # 特定ファイルのみ
```

### テスト戦略

**Pure data (core/ + Interface Adapter)** は fabric / DOM 抜きで unit test:

- `core/path/*` — types / Path / Anchors / bezier / coords / segment-hit / overlay-layout
- `core/object-id.ts` — `ensureObjectId` の挙動
- `core/history/history.ts` — ring buffer + cursor (wrap-around / overflow / undo→redo / edge case)
- `core/outline-position.ts` — アウトライン位置計算
- `renderer/path-adapter.ts` — fabric 生タプル ↔ PathCommand 境界変換 (Interface Adapter)
- `renderer/copy-export.ts` — `toCanvasElement` 引数の typed wrapper

**Tool / Interactor** は **real `class State` (renderer/state.ts) + fabric の最小 stub** で test。State は production の唯一の実装なので fake にすると tautology になる:

- `test/fabric-stub.ts` — fabric の最小 stub (Canvas / Path / Text / IText / ActiveSelection / Polyline.prototype._setPositionDimensions) を集約。`installFabricStub()` で `globalThis.fabric` & `window` stub を install
- 各 tool test (`tools-*.test.ts`) は `installFabricStub()` の後 `new State(new FakeFabricCanvas() as never)` で real State を構築、fixture 投入は `state.applySnapshot()` 経由
- assertion は **State の public API のみ** 経由 (`getActivePath().snapshot()` / `linearizeHistory()` / `getActiveObjects()` / `toSnapshot()` 等)。fabric stub の internal counter / 内部 field は peek しない (例外: cursor は実 DOM 観測なので `fabricCanvas.upperCanvasEl.style.cursor` で OK = production でも user は DOM 経由で見る)
- `file-io-interactor.test.ts` は real State + 外部 boundary の test double (`FakeRepo` / `FakeUI` = file system / OS dialog 代用。これらは production も interface 経由なので legitimate な test double)

### test 用 tsconfig 設定

`tsconfig.test.json` に `lib: ["ES2022","DOM"]` / `types: [..., "fabric"]` / `allowUmdGlobalAccess: true` / `src/globals/` の include を入れている (= ts-jest が `src/renderer/state.ts` を test から compile するため)。`src/renderer/outline-conversion` は top-level で `document.getElementById` を呼ぶので test 側で `jest.mock` で stub する (font-enumeration の lazy 化が本筋だが未着手)。

## 新しいコードを書く時のガイドライン

### CA 層を意識する

新規ファイルを書くとき**どの CA 層か** を考える (Entity / UseCase / Port / Adapter / Presenter / Framework)。

- **`core/`**: pure function + value object + 抽象 interface。DOM/fabric/Electron 不知
- **`usecases/`**: アプリ固有 orchestration。tool-driven は `tools/`、menu-triggered は `menu/`
  - state または external dependency があるなら **class + DI** (例: `FileIOInteractor`、`SelectCharTool`)。constructor で State / Repository / UIPort を受け取る
  - stateless な単発 orchestration は **free function** (例: `selectAll(state)`)
  - pure な変換 (validator / formatter) も free function 据え置き (= AnemicHelper anti-pattern を避ける)
- **`repository/`**: 永続化 port + concrete を併置。port: `<entity>-repository.ts`、concrete: `<adapter>-<entity>-repository.ts`
- **`renderer/`**: 副作用あり (DOM/fabric/Electron)。State concrete impl、UI 配線、event dispatcher、Presenter
- **`globals/`**: 外部世界の ambient `.d.ts` のみ

path 関連のロジック (アンカー / ハンドル / ベジェ評価 / コマンド変換) は `core/path/`、tool 実装は `usecases/tools/`、menu / keyboard 起点 use case は `usecases/menu/`。

### 既存の癒着を新規に増やさない

- 新しい tool / use case に fabric を直接 import しない (= State interface 経由)
- core/ に fabric / DOM / Electron を import しない
- `*Controller` を Use Case の suffix に使わない (= `*Interactor` か free function、または `*Tool`)
- `active.type === 'activeSelection'` のような fabric 文字列タグ依存を新規には書かない (= `host.getActiveObjects().length` で判定)
- 既存の癒着を「ついでに直す」のは scope を意識的に切ってから

### pure helper を core に動かすかの判定

CA dependency rule (= 外向き依存禁止) は守るが、「全 pure 関数は core にあるべき」ではない。renderer / tools 内の pure helper を core/ に動かす実利は以下 3 点で判定:

1. **多層から import されているか** (= dependency 圧)
2. **単独でテスト書きたい domain knowledge か** (= 罠 / 仕様の塊)
3. **コードベース読んだ時「これ core じゃね?」と迷うか** (= 認知負荷)

**全部 No なら据え置き**。pure であることだけで動かすと import path noise が増えるだけ。逆に dependency rule 違反 (例: core から fabric を触る) なら問答無用で動かす。

### 新機能への指針

- 移動 / 選択 / スナップは `fabric.Text` 特有フィールドではなく **汎用プロパティ** (`target.left`, `target.top`, `target.angle`) に対して書く。スナップハンドラがテンプレ
- `data` にテキスト専用フィールドを足さない (以前 `data.baselineY` があったが削除済)
- Illustrator / Photoshop / Figma の UX 慣習を優先 (例: Alt で一時制約解除、Cmd+Shift+O でアウトライン化)

### Selection 抽象化への配慮 (将来の方向)

camera 層の selection は現状 fabric の生 active object に散らばっており (`canvas.getActiveObject()` / `host.getActiveObjects()` / 各 tool ローカルの `drag` フィールド等)、将来 `Selection` (kind: `'objects' | 'anchors' | 'handles' | 'none'`、ID ベース) として一級概念に整理予定。**複数アンカー同時選択** を本格的にやる手前が自然な着手タイミング。それまでは:

- 新しい選択経路を追加するなら **host 経由を徹底**、fabric API 直叩きを増やさない
- ハンドル / アンカー選択を扱う新機能は、tool-local drag state を拡張する前に「これは Selection 抽象に乗せるべきか」を一度検討
- Command は ID ベース (`fabric.Object` 参照ではなく `ObjectId`) を維持。fabric.Object 解決の唯一の経路は `renderer/state.ts` 内 private `resolveObjectById`
- undo/redo は selection を能動的に切り替えない (= camera 層は履歴対象外)

## 実装済 / 今後実装予定

実装済:

- アウトライン化 + アンカー / ハンドル編集
- アンカー追加 / 削除 (pen ツール)
- Undo/Redo + state-jump semantic
- 保存 / 開く (`.mply` + atomic write + dirty tracking + close guard)

今後:

- bbox 再計算の改善 (`pathOffset` 補正の精緻化)
- 複数アンカー同時選択 (= Selection 抽象化と同時着手予定)
- スムーズ / コーナーアンカーの変換
- アンカードラッグ時のグリッドスナップ

## UI 言語

ツールバーラベル / ツールチップ / トーストは**日本語**。新規ユーザー向け文字列も日本語維持。

## 外部リソース

### Trello Wiki カード (= mojiplay の正式な設計 / 進捗 Wiki)

mojiplay の Trello Wiki カードは **https://trello.com/c/lQu6eVB3** (これ 1 つだけ)。「Trello 更新して」「Wiki 書き直して」「現状を Trello に反映して」等の依頼を受けたら、必ずこのカードを編集すること。

**注意**:

- `mcp__claude_ai_Trello_Discussion_Log__list_recent_discussions` で `mojiplay:` で始まる他のカードが見つかっても **Wiki と勘違いしない**こと。それらは過去議論ログ (snapshot) で、`update_card_body` で書き換えると過去議論の記録性が壊れる。Wiki 用の更新は上記 1 つの正カードに集約
- Trello MCP には card archive / delete API は無い (`save_discussion` / `update_card_body` / `append_to_discussion` / `add_attachment_url` のみ)。誤って書き換え / 新規作成した場合は **ユーザに Trello UI 上で archive を依頼する**しかない
