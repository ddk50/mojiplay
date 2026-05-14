// fabric.Object に mojiplay 固有の user data フィールドを足すための ambient 宣言。
//
// `canvas.toJSON(['data'])` で `data` キーを永続化対象に含めるのが fabric 公式の
// やり方であり、ここで宣言する `data` は mojiplay が **自分で書き込むフィールド** で
// あって fabric の internal ではない。よって declaration merging で global に
// augment して良い (= 嘘ではない拡張)。
//
// 注: fabric の undocumented internal (contextTop / __charBounds / pathOffset /
// _setPositionDimensions 等) は global augment しない。call site が「公開 API のように
// 見える嘘の型」に依存すると、fabric の minor version bump で rename されたときに
// runtime まで検出できない。それら internal へのアクセスは src/renderer/fabric-internals.ts
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
  }
}

export {};
