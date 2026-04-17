# mojiplay

文字を一文字ずつ自由に配置・アウトライン化・ベジェ編集して透過PNGとして書き出すためのデスクトップアプリ。

## インストール

Node.js（v20以上）が必要です。

```bash
git clone <このリポジトリのURL>
cd mojiplay
npm install
```

## 起動

```bash
npm start
```

## テスト実行

```bash
npm test
```

[Jest](https://jestjs.io/) + [ts-jest](https://kulshekhar.github.io/ts-jest/) でユニットテストを実行します。

## Windows向けバイナリのビルド

[electron-builder](https://www.electron.build/) を使って Portable .exe (x64) を生成します。

### 1. WSL2/Linux に wine をインストール

実行ファイルのメタデータ書き換えに `wine` が必要です（Ubuntu/Debian の例）。

```bash
sudo apt update
sudo apt install -y wine64
```

### 2. ビルド

```bash
npm run dist:win
```

成果物は以下に生成されます。

```
release/mojiplay-1.0.0-portable-x64.exe
```

これを Windows PC にコピーするだけで起動します（インストール不要）。

### 動作確認のみ（wine不要）

```bash
npm run pack
```

`release/win-unpacked/` に展開済みの実行ディレクトリが生成されます。
中の `mojiplay.exe` を実機に持っていけば起動可能です。

### アイコンの差し替え

`build/icon.ico` (256×256以上) を置けば自動でアプリのアイコンになります。詳細は [`build/README.md`](./build/README.md) を参照。

## 機能

- テキストを入力すると一文字ずつ独立したオブジェクトとしてキャンバスに配置
- 各文字をマウスでドラッグして自由に移動・回転・拡大縮小
- フォント・サイズ・色を選択中の文字にリアルタイム適用
- アウトライン化 (Ctrl+Shift+O): テキストをベジェパスに変換
- 白矢印ツールでアンカーポイントをドラッグしてパスを編集
- 選択オブジェクトを透過PNGとしてクリップボードにコピー (Ctrl+C / Edit > Copy)
- 透過PNGとしてローカルに書き出し
- `Delete` / `Backspace` で選択中のオブジェクトを削除
- Alt + マウスホイールでズーム (カーソル位置中心)
- グリッドスナップ (白矢印モード、Alt で一時バイパス)

## 技術スタック

| 用途 | ライブラリ |
|------|-----------|
| デスクトップフレームワーク | [Electron](https://www.electronjs.org/) v29 |
| キャンバス操作 | [Fabric.js](http://fabricjs.com/) v5.3 |
| フォントパス解析 | [fontkit](https://github.com/foliojs/fontkit) v2 |
| テスト | [Jest](https://jestjs.io/) + [ts-jest](https://kulshekhar.github.io/ts-jest/) |

## ライセンス

MIT
