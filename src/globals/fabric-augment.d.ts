// fabric の public API のうち、@types/fabric が宣言漏れ・誤定義しているものを
// declaration merging で補う ambient 宣言。
//
// ここで augment して良いのは「fabric が公式に提供している API」のみ:
//   - mojiplay 固有 user data フィールド (`Object.data`) は canvas.toJSON(['data']) で
//     永続化対象にするための fabric 公式の拡張口。mojiplay 自身が書き込む値なので嘘なし。
//   - `IText.isEditing` / `Canvas.getRetinaScaling()` は fabric の docs に記載のある
//     public API だが @types/fabric が宣言漏れしている。runtime には確かに存在する。
//
// 注: fabric の undocumented internal (contextTop / __charBounds / pathOffset /
// _setPositionDimensions 等) はここに書かない。call site が「公開 API のように見える
// 嘘の型」に依存すると、fabric の minor version bump で rename されたときに runtime
// まで検出できない。それら internal へのアクセスは src/renderer/fabric-internals.ts
// に集約し、ファイルローカルな interface + narrow cast で扱う。
//
// なお `fabric.Path.path` は @types/fabric が `Point[]` と誤定義しているが、interface
// declaration merging は同名 property の型一致を要求するため override 不可。call site
// (renderer/state.ts) で `as unknown as PathCommandArray` キャストする運用。

declare global {
  namespace fabric {
    interface Object {
      /** mojiplay 固有 user data (canvas.toJSON(['data']) で永続化される)。
       *  shape は core/object-id.ts の MojiplayObjectData と structural に一致。 */
      data?: {
        /** ULID 文字列 (core/object-id.ts の ObjectId と同一の branded string)。 */
        objectId?: string & { readonly __brand: 'ObjectId' };
        type?: 'text' | 'path';
        groupId?: string;
        charIndex?: number;
        sourceText?: string;
        outlined?: boolean;
      };
    }

    interface IText {
      /** 編集モードの最中か (fabric public、@types/fabric が宣言漏れ)。 */
      isEditing?: boolean;
    }

    interface Canvas {
      /** retina スケール (= window.devicePixelRatio 相当)。fabric public、@types/fabric
       *  が宣言漏れ。contextTop に直接描画する時に setTransform で掛ける。 */
      getRetinaScaling(): number;
    }
  }
}

export {};
