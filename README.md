# Font Layout Editor

デザイナーがフォントのアウトライン化なしに、一文字ずつ自由に配置・調整して透過PNGとして書き出すためのデスクトップアプリ。

## インストール

Node.js（v18以上）が必要です。

```bash
git clone <このリポジトリのURL>
cd myfonteditor
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

> 現在テストは未実装です。将来的に [Vitest](https://vitest.dev/) + [Spectron](https://github.com/electron-userland/spectron) によるユニットテスト・E2Eテストを追加予定です。

## 機能

- テキストを入力すると一文字ずつ独立したオブジェクトとしてキャンバスに配置
- 各文字をマウスでドラッグして自由に移動・回転・拡大縮小
- フォント・サイズ・色を選択中の文字にリアルタイム適用
- 透過PNGとしてローカルに書き出し
- `Delete` / `Backspace` で選択中の文字を削除

## 技術スタック

| 用途 | ライブラリ |
|------|-----------|
| デスクトップフレームワーク | [Electron](https://www.electronjs.org/) v29 |
| 文字オブジェクト操作 | [Fabric.js](http://fabricjs.com/) v5.3 |
| フォントパス解析（将来用） | [opentype.js](https://opentype.js.org/) |

## ライセンス

MIT
