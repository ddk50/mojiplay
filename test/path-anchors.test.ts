// パスアンカーポイント抽出・移動の単体テスト
//
// ── PathCommand (オブジェクト ADT) ─────────────────────────────────────
//
//   { type: 'M', to: {x, y} }                       MoveTo
//   { type: 'L', to: {x, y} }                       LineTo
//   { type: 'C', c1: {x,y}, c2: {x,y}, to: {x,y} }  Cubic
//       c1 = 始点側制御点 (前のアンカーの outgoing handle)
//       c2 = 終点側制御点 (このアンカーの incoming handle)
//       to = 終点 (アンカー)
//   { type: 'Q', c: {x,y}, to: {x,y} }              Quadratic
//       c = 制御点 (前後の両アンカーに共有)
//       to = 終点 (アンカー)
//   { type: 'Z' }                                    ClosePath
//
// HandleRef は kind による意味タグ:
//   { kind: 'C-c1', cmdIndex }   C の c1 (= 直前アンカーの outgoing)
//   { kind: 'C-c2', cmdIndex }   C の c2 (= 末尾アンカーの incoming)
//   { kind: 'Q-c',  cmdIndex }   Q の制御点
//
// fabric の生タプル形式との境界変換 (fromFabricPath / toFabricPath) は
// renderer-path-adapter.test.ts でテスト。

import type { Point, PathCommand, HandleRef } from '../src/core/path/types';
import {
  extractAnchors, moveAnchorRigid, moveHandle, evalCubicAt, evalQuadAt,
  getSegmentStart, splitSegment, removeAnchor, getHandlePoint,
} from '../src/core/path/anchors';

// 短縮ヘルパ: テストの可読性向上のため
const M  = (x: number, y: number): PathCommand => ({ type: 'M', to: { x, y } });
const L  = (x: number, y: number): PathCommand => ({ type: 'L', to: { x, y } });
const C  = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): PathCommand =>
  ({ type: 'C', c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, to: { x, y } });
const Q  = (cx: number, cy: number, x: number, y: number): PathCommand =>
  ({ type: 'Q', c: { x: cx, y: cy }, to: { x, y } });
const Z  = (): PathCommand => ({ type: 'Z' });

// ── extractAnchors ──────────────────────────────────────────────────────

describe('extractAnchors', () => {
  test('直線ポリゴン (M L L Z) → アンカー3個、ハンドル全て null', () => {
    const path: PathCommand[] = [M(0, 0), L(10, 0), L(5, 10), Z()];
    const anchors = extractAnchors(path);

    expect(anchors).toHaveLength(3);

    expect(anchors[0].point).toEqual({ x: 0, y: 0 });
    expect(anchors[0].subpathStart).toBe(true);
    expect(anchors[0].incomingHandle).toBeNull();
    expect(anchors[0].outgoingHandle).toBeNull();

    expect(anchors[1].point).toEqual({ x: 10, y: 0 });
    expect(anchors[1].subpathStart).toBe(false);

    expect(anchors[2].point).toEqual({ x: 5, y: 10 });
    expect(anchors[2].subpathStart).toBe(false);
  });

  test('三次ベジェ (M C C Z) 直線 close → 中間アンカーのハンドル + 開始アンカーは incoming 無し', () => {
    // 最後の C(...,10,10) が M(0,0) と一致しないので、Z は直線で閉じる semantic。
    // 開始アンカーには曲線の incoming は付かない (= null)。
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      Z(),
    ];
    const anchors = extractAnchors(path);

    expect(anchors).toHaveLength(3);

    expect(anchors[0]).toMatchObject({ point: { x: 0, y: 0 }, subpathStart: true });
    expect(anchors[0].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 1 });
    expect(anchors[0].incomingHandle).toBeNull();
    expect(anchors[0].coincidentClosingCmdIndex).toBeNull();

    expect(anchors[1]).toMatchObject({ point: { x: 5, y: 5 } });
    expect(anchors[1].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 1 });
    expect(anchors[1].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 2 });

    expect(anchors[2]).toMatchObject({ point: { x: 10, y: 10 } });
    expect(anchors[2].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 2 });
    expect(anchors[2].outgoingHandle).toBeNull();
  });

  test('三次ベジェ (M C C Z) 曲線 close → 重複アンカー削除 + 開始アンカーに incoming + coincident', () => {
    // 最後の C(...,0,0) が M(0,0) と一致するので、曲線で閉じる semantic。
    // 最後の C の to は M と座標重複なので「3 個目のアンカー」は extract されず、
    // 開始アンカーが最後の curve の c2 を incoming として保持する。
    // coincidentClosingCmdIndex で「M を動かす時 C.to も同期する」関係を記録。
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 0, 0),
      Z(),
    ];
    const anchors = extractAnchors(path);

    expect(anchors).toHaveLength(2);

    expect(anchors[0]).toMatchObject({ point: { x: 0, y: 0 }, subpathStart: true });
    expect(anchors[0].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 1 });
    expect(anchors[0].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 2 });
    expect(anchors[0].coincidentClosingCmdIndex).toBe(2);

    expect(anchors[1]).toMatchObject({ point: { x: 5, y: 5 } });
    expect(anchors[1].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 1 });
    expect(anchors[1].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 2 });
  });

  test('二次ベジェ混在 (M Q L) → Q のハンドル紐付け', () => {
    const path: PathCommand[] = [M(0, 0), Q(5, 10, 10, 0), L(15, 5)];
    const anchors = extractAnchors(path);

    expect(anchors).toHaveLength(3);
    expect(anchors[0].outgoingHandle).toEqual({ kind: 'Q-c', cmdIndex: 1 });
    expect(anchors[1]).toMatchObject({ point: { x: 10, y: 0 } });
    expect(anchors[1].incomingHandle).toEqual({ kind: 'Q-c', cmdIndex: 1 });
    expect(anchors[2].incomingHandle).toBeNull();
    expect(anchors[2].outgoingHandle).toBeNull();
  });

  test('2 サブパス (M L Z M L Z) → 4 アンカー、subpathStart 2個', () => {
    const path: PathCommand[] = [
      M(0, 0), L(10, 10), Z(),
      M(20, 20), L(30, 30), Z(),
    ];
    const anchors = extractAnchors(path);

    expect(anchors).toHaveLength(4);
    expect(anchors[0].subpathStart).toBe(true);
    expect(anchors[1].subpathStart).toBe(false);
    expect(anchors[2].subpathStart).toBe(true);
    expect(anchors[3].subpathStart).toBe(false);
    expect(anchors[2]).toMatchObject({ point: { x: 20, y: 20 } });
  });

  test('M C C Z 直線 close: 開始アンカー incoming は null', () => {
    // 最後の C(...,6,6) が M(0,0) と一致しない → 直線 close
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 1, 2, 2, 3, 3),
      C(4, 4, 5, 5, 6, 6),
      Z(),
    ];
    const anchors = extractAnchors(path);
    expect(anchors[0].incomingHandle).toBeNull();
    expect(anchors[0].coincidentClosingCmdIndex).toBeNull();
  });

  test('M C Z 単一曲線で閉じる → 1 アンカーで両ハンドル保持', () => {
    // M と単一 C で形成される閉ループ。C の to が M と一致するので、anchor は
    // 1 個 (= start anchor) になり、両端ハンドル (incoming/outgoing) ともに
    // 同じ C 命令の c2/c1 を指す。
    const path: PathCommand[] = [
      M(0, 0),
      C(10, 0, 10, 20, 0, 0),
      Z(),
    ];
    const anchors = extractAnchors(path);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].point).toEqual({ x: 0, y: 0 });
    expect(anchors[0].subpathStart).toBe(true);
    expect(anchors[0].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 1 });
    expect(anchors[0].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 1 });
    expect(anchors[0].coincidentClosingCmdIndex).toBe(1);
  });
});

// ── moveAnchorRigid ─────────────────────────────────────────────────────

describe('moveAnchorRigid', () => {
  test('直線端点の移動', () => {
    const path: PathCommand[] = [M(0, 0), L(10, 0), L(5, 10), Z()];
    const result = moveAnchorRigid(path, 1, 3, -2);

    expect(result[1]).toEqual(L(13, -2));
    expect(result[0]).toEqual(M(0, 0));
    expect(result[2]).toEqual(L(5, 10));
    expect(result[3]).toEqual(Z());
  });

  test('三次ベジェのアンカー移動 (アンカー + 付属ハンドル追従)', () => {
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      Z(),
    ];
    const result = moveAnchorRigid(path, 1, 10, -5);

    expect(result[1]).toEqual(C(1, 2, 13, -1, 15, 0));
    expect(result[2]).toEqual(C(16, 2, 8, 9, 10, 10));
    expect(result[0]).toEqual(M(0, 0));
    expect(result[3]).toEqual(Z());
  });

  test('閉曲線 (曲線 close) M 移動 → M.to + 前後ハンドル + 最後 C.to が同期', () => {
    // 最後の C が M(0,0) で閉じる semantic。M を (2,3) 動かすと:
    //  - M.to が (2,3) に移動
    //  - 開始アンカーの outgoing (= 最初の C の c1) が追従
    //  - 開始アンカーの incoming (= 最後の C の c2) が追従
    //  - 最後の C の to も (0,0)→(2,3) に同期 (coincidentClosingCmdIndex 経由)
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 0, 0),
      Z(),
    ];
    const result = moveAnchorRigid(path, 0, 2, 3);

    expect(result[0]).toEqual(M(2, 3));
    expect(result[1]).toEqual(C(3, 5, 3, 4, 5, 5));
    // 最後 C: c1 不変、c2 追従 (incoming)、to 追従 (coincident close)
    expect(result[2]).toEqual(C(6, 7, 10, 12, 2, 3));
  });

  test('immutability — 変化したコマンドだけ新規、他は同一参照', () => {
    const cmd0 = M(0, 0);
    const cmd1 = L(10, 0);
    const cmd2 = L(5, 10);
    const cmd3 = Z();
    const path = [cmd0, cmd1, cmd2, cmd3];

    const result = moveAnchorRigid(path, 1, 1, 1);

    expect(result).not.toBe(path);
    expect(result[0]).toBe(cmd0);
    expect(result[2]).toBe(cmd2);
    expect(result[3]).toBe(cmd3);
    expect(result[1]).not.toBe(cmd1);
    expect(result[1]).toEqual(L(11, 1));
  });

  test('範囲外の anchorIndex → 元配列のコピーを返す', () => {
    const path: PathCommand[] = [M(0, 0), L(10, 0)];
    const result = moveAnchorRigid(path, 99, 5, 5);
    expect(result).toEqual(path);
    expect(result).not.toBe(path);
  });
});

// ── 回帰フィクスチャ ────────────────────────────────────────────────────

describe('回帰: 擬似「O」グリフ (4点閉曲線)', () => {
  const path: PathCommand[] = [
    M(50, 0),
    C(77.6, 0, 100, 22.4, 100, 50),
    C(100, 77.6, 77.6, 100, 50, 100),
    C(22.4, 100, 0, 77.6, 0, 50),
    C(0, 22.4, 22.4, 0, 50, 0),
    Z(),
  ];

  test('アンカー数 = 4 (closed curve の重複起点を 1 個にマージ)', () => {
    // O は top/right/bottom/left の 4 隅。最後の C が top に戻ってくるが、
    // 重複 anchor は extract されない (Z 処理でマージ)。
    const anchors = extractAnchors(path);
    expect(anchors).toHaveLength(4);
    // 開始アンカー: 両ハンドル + coincident closing index
    expect(anchors[0].point).toEqual({ x: 50, y: 0 });
    expect(anchors[0].subpathStart).toBe(true);
    expect(anchors[0].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 1 });
    expect(anchors[0].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 4 });
    expect(anchors[0].coincidentClosingCmdIndex).toBe(4);
  });

  test('Top (M) を下に 20px 移動', () => {
    const result = moveAnchorRigid(path, 0, 0, 20);

    expect(result[0]).toEqual(M(50, 20));
    // outgoing handle (1番目 C の c1) が追従
    const r1 = result[1];
    expect(r1.type).toBe('C');
    if (r1.type !== 'C') throw new Error('expected C');
    expect(r1.c1).toEqual({ x: 77.6, y: 20 });
    // C[0] の c2 と to は不変
    expect(r1.c2).toEqual({ x: 100, y: 22.4 });
    expect(r1.to).toEqual({ x: 100, y: 50 });
    // 最後 C: c2 (incoming) 追従 + to (coincident close) も追従
    const r4 = result[4];
    expect(r4.type).toBe('C');
    if (r4.type !== 'C') throw new Error('expected C');
    expect(r4.c1).toEqual({ x: 0, y: 22.4 });   // 不変 (前 anchor の outgoing)
    expect(r4.c2).toEqual({ x: 22.4, y: 20 });  // 追従 (start anchor incoming)
    expect(r4.to).toEqual({ x: 50, y: 20 });    // 追従 (coincident close, M と同期)
    // C[2], C[3] 完全不変 (同一参照)
    expect(result[2]).toBe(path[2]);
    expect(result[3]).toBe(path[3]);
  });
});

// ── moveHandle ──────────────────────────────────────────────────────────

describe('moveHandle', () => {
  test('C コマンドの incoming ハンドル移動 → c2 のみ変化', () => {
    const path: PathCommand[] = [M(0, 0), C(1, 2, 3, 4, 5, 5), Z()];
    const handle: HandleRef = { kind: 'C-c2', cmdIndex: 1 };
    const result = moveHandle(path, handle, 10, -5);

    expect(result[1]).toEqual(C(1, 2, 13, -1, 5, 5));
  });

  test('C コマンドの outgoing ハンドル移動 → c1 のみ変化', () => {
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      Z(),
    ];
    const handle: HandleRef = { kind: 'C-c1', cmdIndex: 2 };
    const result = moveHandle(path, handle, -3, 4);

    expect(result[2]).toEqual(C(3, 11, 8, 9, 10, 10));
    // アンカー・他コマンド不変
    expect(result[0]).toEqual(M(0, 0));
    expect(result[1]).toEqual(C(1, 2, 3, 4, 5, 5));
  });

  test('Q コマンドの共有制御点移動', () => {
    const path: PathCommand[] = [M(0, 0), Q(5, 10, 10, 0), Z()];
    const handle: HandleRef = { kind: 'Q-c', cmdIndex: 1 };
    const result = moveHandle(path, handle, 2, -3);

    expect(result[1]).toEqual(Q(7, 7, 10, 0));
  });

  test('immutability — 変更コマンドだけ新規、他は同一参照', () => {
    const cmd0 = M(0, 0);
    const cmd1 = C(1, 2, 3, 4, 5, 5);
    const cmd2 = Z();
    const path = [cmd0, cmd1, cmd2];

    const handle: HandleRef = { kind: 'C-c2', cmdIndex: 1 };
    const result = moveHandle(path, handle, 1, 1);

    expect(result).not.toBe(path);
    expect(result[0]).toBe(cmd0);   // 同一参照
    expect(result[2]).toBe(cmd2);   // 同一参照
    expect(result[1]).not.toBe(cmd1); // 新規
    expect(result[1]).toEqual(C(1, 2, 4, 5, 5, 5));
  });

  test('アンカー座標は不変', () => {
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      Z(),
    ];
    const anchorsBefore = extractAnchors(path);

    // incoming ハンドルを移動
    const handle: HandleRef = { kind: 'C-c2', cmdIndex: 1 };
    const result = moveHandle(path, handle, 100, 100);
    const anchorsAfter = extractAnchors(result);

    // アンカー座標は全て同一
    for (let i = 0; i < anchorsBefore.length; i++) {
      expect(anchorsAfter[i].point).toEqual(anchorsBefore[i].point);
    }
  });

  test('範囲外の cmdIndex → 元配列のコピーを返す', () => {
    const path: PathCommand[] = [M(0, 0), L(10, 0)];
    const handle: HandleRef = { kind: 'C-c1', cmdIndex: 99 };
    const result = moveHandle(path, handle, 5, 5);
    expect(result).toEqual(path);
    expect(result).not.toBe(path);
  });

  test('kind とコマンド種別が不一致 → コマンド変化なし', () => {
    // C-c1 を L に対して適用 (= 何もしない)
    const path: PathCommand[] = [M(0, 0), L(10, 0)];
    const handle: HandleRef = { kind: 'C-c1', cmdIndex: 1 };
    const result = moveHandle(path, handle, 5, 5);
    expect(result[1]).toEqual(L(10, 0));
  });
});

// ── evalCubicAt / evalQuadAt ────────────────────────────────────────────

describe('evalCubicAt', () => {
  test('t=0 → 始点, t=1 → 終点', () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 10, y: 20 };
    const c2 = { x: 30, y: 40 };
    const p3 = { x: 50, y: 50 };
    expect(evalCubicAt(p0, c1, c2, p3, 0)).toEqual(p0);
    expect(evalCubicAt(p0, c1, c2, p3, 1)).toEqual(p3);
  });

  test('t=0.5 の直線 → 中点', () => {
    // 制御点が始点-終点の直線上にある場合、曲線も直線
    const r = evalCubicAt({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, 0.5);
    expect(r.x).toBeCloseTo(15);
    expect(r.y).toBeCloseTo(0);
  });
});

describe('evalQuadAt', () => {
  test('t=0 → 始点, t=1 → 終点', () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 5, y: 10 };
    const p2 = { x: 10, y: 0 };
    expect(evalQuadAt(p0, c1, p2, 0)).toEqual(p0);
    expect(evalQuadAt(p0, c1, p2, 1)).toEqual(p2);
  });
});

// ── getSegmentStart ─────────────────────────────────────────────────────

describe('getSegmentStart', () => {
  test('C コマンドの始点 = 直前の M', () => {
    const path: PathCommand[] = [M(10, 20), C(1, 2, 3, 4, 5, 6), Z()];
    expect(getSegmentStart(path, 1)).toEqual({ x: 10, y: 20 });
  });

  test('2番目の C の始点 = 直前の C の終点', () => {
    const path: PathCommand[] = [
      M(0, 0), C(1, 2, 3, 4, 5, 5), C(6, 7, 8, 9, 10, 10), Z(),
    ];
    expect(getSegmentStart(path, 2)).toEqual({ x: 5, y: 5 });
  });

  test('M の前 → null', () => {
    const path: PathCommand[] = [M(0, 0)];
    expect(getSegmentStart(path, 0)).toBeNull();
  });
});

// ── splitSegment ────────────────────────────────────────────────────────

describe('splitSegment', () => {
  test('C を t=0.5 で分割 → コマンド数が 1 増加', () => {
    const path: PathCommand[] = [M(0, 0), C(30, 0, 70, 100, 100, 100), Z()];
    const result = splitSegment(path, 1, 0.5);
    expect(result).toHaveLength(4); // M, C, C, Z

    // 分割点は元の曲線の t=0.5 上にある
    const s = evalCubicAt({ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 70, y: 100 }, { x: 100, y: 100 }, 0.5);
    const r1 = result[1];
    expect(r1.type).toBe('C');
    if (r1.type !== 'C') throw new Error('expected C');
    expect(r1.to.x).toBeCloseTo(s.x);
    expect(r1.to.y).toBeCloseTo(s.y);
    // 第2セグメントの終点は元の終点
    const r2 = result[2];
    expect(r2.type).toBe('C');
    if (r2.type !== 'C') throw new Error('expected C');
    expect(r2.to).toEqual({ x: 100, y: 100 });
  });

  test('C を t=0 / t=1 で分割 → 退化 (始点/終点に新アンカー)', () => {
    const path: PathCommand[] = [M(0, 0), C(10, 0, 20, 0, 30, 0), Z()];
    const r0 = splitSegment(path, 1, 0);
    expect(r0).toHaveLength(4);
    const r0_1 = r0[1];
    if (r0_1.type !== 'C') throw new Error('expected C');
    expect(r0_1.to.x).toBeCloseTo(0);
    expect(r0_1.to.y).toBeCloseTo(0);

    const r1 = splitSegment(path, 1, 1);
    expect(r1).toHaveLength(4);
    const r1_1 = r1[1];
    if (r1_1.type !== 'C') throw new Error('expected C');
    expect(r1_1.to.x).toBeCloseTo(30);
    expect(r1_1.to.y).toBeCloseTo(0);
  });

  test('L を t=0.5 で分割 → 2 つの L', () => {
    const path: PathCommand[] = [M(0, 0), L(10, 10), Z()];
    const result = splitSegment(path, 1, 0.5);
    expect(result).toHaveLength(4);
    expect(result[1]).toEqual(L(5, 5));
    expect(result[2]).toEqual(L(10, 10));
  });

  test('Q を t=0.5 で分割 → 2 つの Q', () => {
    const path: PathCommand[] = [M(0, 0), Q(5, 10, 10, 0), Z()];
    const result = splitSegment(path, 1, 0.5);
    expect(result).toHaveLength(4);
    expect(result[1].type).toBe('Q');
    expect(result[2].type).toBe('Q');
    // 第2セグメントの終点は元の終点
    const r2 = result[2];
    if (r2.type !== 'Q') throw new Error('expected Q');
    expect(r2.to).toEqual({ x: 10, y: 0 });
  });

  test('他のコマンドは不変', () => {
    const cmd0 = M(0, 0);
    const cmd2 = Z();
    const path = [cmd0, L(10, 10), cmd2];
    const result = splitSegment(path, 1, 0.5);
    expect(result[0]).toBe(cmd0);
    expect(result[3]).toBe(cmd2);
  });
});

// ── removeAnchor ────────────────────────────────────────────────────────

describe('removeAnchor', () => {
  test('中間アンカー削除 → 直線 L に置換', () => {
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      Z(),
    ];
    const result = removeAnchor(path, 1); // anchor (5,5) を削除
    expect(result).toHaveLength(3); // M, L, Z
    expect(result[0]).toEqual(M(0, 0));
    expect(result[1]).toEqual(L(10, 10)); // 直線化
    expect(result[2]).toEqual(Z());
  });

  test('最後のアンカー削除 (Z 直前) → コマンド除去のみ', () => {
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      C(11, 12, 13, 14, 15, 15),
      Z(),
    ];
    const result = removeAnchor(path, 3); // 最後の (15,15) を削除
    expect(result).toHaveLength(4); // M, C, C, Z
    expect(result[0]).toEqual(M(0, 0));
    expect(result[2]).toEqual(path[2]); // 2番目の C は不変
    expect(result[3]).toEqual(Z());
  });

  test('M アンカー削除 → 次のアンカーが新 M', () => {
    const path: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      Z(),
    ];
    const result = removeAnchor(path, 0);
    expect(result).toHaveLength(3); // M, C, Z
    expect(result[0]).toEqual(M(5, 5)); // 新 M は次のアンカー位置
    expect(result[2]).toEqual(Z());
  });

  test('サブパスのアンカーが 2 以下 → 操作拒否', () => {
    const path: PathCommand[] = [M(0, 0), L(10, 10), Z()];
    const result = removeAnchor(path, 0);
    expect(result).toEqual(path);
    expect(result).not.toBe(path);
  });

  test('範囲外 → 元配列コピー', () => {
    const path: PathCommand[] = [M(0, 0), L(10, 10), Z()];
    const result = removeAnchor(path, 99);
    expect(result).toEqual(path);
  });

  test('擬似 O グリフから中間アンカー削除', () => {
    const path: PathCommand[] = [
      M(50, 0),
      C(77.6, 0, 100, 22.4, 100, 50),
      C(100, 77.6, 77.6, 100, 50, 100),
      C(22.4, 100, 0, 77.6, 0, 50),
      C(0, 22.4, 22.4, 0, 50, 0),
      Z(),
    ];
    const result = removeAnchor(path, 2); // (50, 100) を削除
    expect(result).toHaveLength(5); // M, C, L, C, Z
    expect(result[0]).toEqual(M(50, 0));
    expect(result[1]).toEqual(path[1]); // 第1 C は不変
    expect(result[2]).toEqual(L(0, 50)); // (50,100)→(0,50) が直線化
    expect(result[3]).toEqual(path[4]); // 最後の C は不変
  });
});

// ── getHandlePoint ──────────────────────────────────────────────────────

describe('getHandlePoint', () => {
  test('C-c1 / C-c2 / Q-c が正しい Point を返す', () => {
    const c = C(1, 2, 3, 4, 5, 6);
    expect(getHandlePoint(c, { kind: 'C-c1', cmdIndex: 0 })).toEqual({ x: 1, y: 2 });
    expect(getHandlePoint(c, { kind: 'C-c2', cmdIndex: 0 })).toEqual({ x: 3, y: 4 });

    const q = Q(7, 8, 9, 10);
    expect(getHandlePoint(q, { kind: 'Q-c', cmdIndex: 0 })).toEqual({ x: 7, y: 8 });
  });

  test('kind とコマンド種別が不一致 → null', () => {
    expect(getHandlePoint(L(0, 0), { kind: 'C-c1', cmdIndex: 0 })).toBeNull();
    expect(getHandlePoint(C(1, 2, 3, 4, 5, 6), { kind: 'Q-c', cmdIndex: 0 })).toBeNull();
  });
});
