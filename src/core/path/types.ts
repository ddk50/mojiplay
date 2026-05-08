// パス操作の共通型定義 (ドメイン語彙)。
//
// path/anchors.ts / path/fabric-adapter.ts などが共有する型を提供する。
// 網羅性チェックは `x satisfies never` 構文を使用 (TS 4.9+)。

export type Point = { readonly x: number; readonly y: number };

// SVG パスコマンドのオブジェクト ADT。
//
// M / L
//   to = アンカー位置 (M はサブパス開始、L は直線で繋ぐ)
//
// C (Cubic Bézier)
//   始点 = 直前コマンドの to (現在点)
//   c1   = 始点側制御点 = 直前アンカーの outgoing handle
//   c2   = 終点側制御点 = このアンカーの incoming handle
//   to   = 終点 (このアンカー)
//
// Q (Quadratic Bézier)
//   始点 = 直前コマンドの to
//   c    = 唯一の制御点 (前後アンカーで共有)
//   to   = 終点
//
// Z
//   ClosePath。サブパス先頭 M に直線で戻る。
export type PathCommand =
  | { readonly type: 'M'; readonly to: Point }
  | { readonly type: 'L'; readonly to: Point }
  | { readonly type: 'C'; readonly c1: Point; readonly c2: Point; readonly to: Point }
  | { readonly type: 'Q'; readonly c: Point; readonly to: Point }
  | { readonly type: 'Z' };

// ハンドル参照は「どのコマンドの、意味的にどの制御点か」で表現する。
// kind 経由で型安全に該当 Point フィールドにアクセスできる。
export type HandleRef =
  | { readonly kind: 'C-c1'; readonly cmdIndex: number }  // C命令の c1 (= 直前アンカーの outgoing)
  | { readonly kind: 'C-c2'; readonly cmdIndex: number }  // C命令の c2 (= 末尾アンカーの incoming)
  | { readonly kind: 'Q-c';  readonly cmdIndex: number }; // Q命令の c

export interface PathAnchor {
  readonly cmdIndex: number;
  readonly point: Point;
  incomingHandle: HandleRef | null;
  outgoingHandle: HandleRef | null;
  readonly subpathStart: boolean;
  /**
   * 曲線で閉じる subpath (最後の C/Q の `to` が subpath 開始 M 点と一致する) で、
   * 開始アンカー (subpathStart=true) のみセットされる「閉じる curve の cmd index」。
   * アンカー本体を動かす際、M.to と一緒にこの curve の to も同期して動かす必要が
   * ある (両者は概念的に同一点なので)。それ以外のアンカーでは null。
   */
  coincidentClosingCmdIndex: number | null;
}

