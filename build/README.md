# build/

このディレクトリは electron-builder の `buildResources` です。

## アイコンの差し替え方

256×256 以上の `icon.ico` をこのディレクトリに置くだけで、
Windowsビルド時に自動でアプリ・実行ファイルのアイコンとして使われます。

```
build/icon.ico
```

ファイルが存在しない場合は Electron デフォルトのアイコンが使われます。
