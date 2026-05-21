// Path 値オブジェクトの単体テスト
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
// 4 点の純 Bezier 数値評価 (evalCubicAt / evalQuadAt) は bezier.test.ts でテスト。

import type { PathCommand, HandleRef } from '../src/window/core/path/types';
import { Path } from '../src/window/core/path/path';

// 短縮ヘルパ: テストの可読性向上のため
const M = (x: number, y: number): PathCommand => ({ type: 'M', to: { x, y } });
const L = (x: number, y: number): PathCommand => ({ type: 'L', to: { x, y } });
const C = (
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x: number,
  y: number,
): PathCommand => ({ type: 'C', c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, to: { x, y } });
const Q = (cx: number, cy: number, x: number, y: number): PathCommand => ({
  type: 'Q',
  c: { x: cx, y: cy },
  to: { x, y },
});
const Z = (): PathCommand => ({ type: 'Z' });

// ── Path.anchors() ──────────────────────────────────────────────────────

describe('Path.anchors', () => {
  test('直線ポリゴン (M L L Z) からアンカー 3 個を抽出してハンドルを全て null にする', () => {
    const anchors = new Path([M(0, 0), L(10, 0), L(5, 10), Z()]).anchors();

    expect(anchors).toHaveLength(3);

    expect(anchors.items[0].point).toEqual({ x: 0, y: 0 });
    expect(anchors.items[0].subpathStart).toBe(true);
    expect(anchors.items[0].incomingHandle).toBeNull();
    expect(anchors.items[0].outgoingHandle).toBeNull();

    expect(anchors.items[1].point).toEqual({ x: 10, y: 0 });
    expect(anchors.items[1].subpathStart).toBe(false);

    expect(anchors.items[2].point).toEqual({ x: 5, y: 10 });
    expect(anchors.items[2].subpathStart).toBe(false);
  });

  test('三次ベジェ (M C C Z) の直線 close では中間アンカーにハンドルを付け開始アンカーの incoming は null になる', () => {
    // 最後の C(...,10,10) が M(0,0) と一致しないので、Z は直線で閉じる semantic。
    // 開始アンカーには曲線の incoming は付かない (= null)。
    const anchors = new Path([M(0, 0), C(1, 2, 3, 4, 5, 5), C(6, 7, 8, 9, 10, 10), Z()]).anchors();

    expect(anchors).toHaveLength(3);

    expect(anchors.items[0]).toMatchObject({ point: { x: 0, y: 0 }, subpathStart: true });
    expect(anchors.items[0].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 1 });
    expect(anchors.items[0].incomingHandle).toBeNull();
    expect(anchors.items[0].coincidentClosingCmdIndex).toBeNull();

    expect(anchors.items[1]).toMatchObject({ point: { x: 5, y: 5 } });
    expect(anchors.items[1].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 1 });
    expect(anchors.items[1].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 2 });

    expect(anchors.items[2]).toMatchObject({ point: { x: 10, y: 10 } });
    expect(anchors.items[2].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 2 });
    expect(anchors.items[2].outgoingHandle).toBeNull();
  });

  test('三次ベジェ (M C C Z) の曲線 close では重複アンカーを削除し開始アンカーに incoming + coincident を付ける', () => {
    // 最後の C(...,0,0) が M(0,0) と一致するので、曲線で閉じる semantic。
    // 最後の C の to は M と座標重複なので「3 個目のアンカー」は extract されず、
    // 開始アンカーが最後の curve の c2 を incoming として保持する。
    const anchors = new Path([M(0, 0), C(1, 2, 3, 4, 5, 5), C(6, 7, 8, 9, 0, 0), Z()]).anchors();

    expect(anchors).toHaveLength(2);

    expect(anchors.items[0]).toMatchObject({ point: { x: 0, y: 0 }, subpathStart: true });
    expect(anchors.items[0].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 1 });
    expect(anchors.items[0].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 2 });
    expect(anchors.items[0].coincidentClosingCmdIndex).toBe(2);

    expect(anchors.items[1]).toMatchObject({ point: { x: 5, y: 5 } });
    expect(anchors.items[1].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 1 });
    expect(anchors.items[1].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 2 });
  });

  test('二次ベジェ混在 (M Q L) では Q のハンドルをアンカーに紐付ける', () => {
    const anchors = new Path([M(0, 0), Q(5, 10, 10, 0), L(15, 5)]).anchors();

    expect(anchors).toHaveLength(3);
    expect(anchors.items[0].outgoingHandle).toEqual({ kind: 'Q-c', cmdIndex: 1 });
    expect(anchors.items[1]).toMatchObject({ point: { x: 10, y: 0 } });
    expect(anchors.items[1].incomingHandle).toEqual({ kind: 'Q-c', cmdIndex: 1 });
    expect(anchors.items[2].incomingHandle).toBeNull();
    expect(anchors.items[2].outgoingHandle).toBeNull();
  });

  test('2 サブパス (M L Z M L Z) から 4 アンカーを抽出し subpathStart を 2 個立てる', () => {
    const anchors = new Path([M(0, 0), L(10, 10), Z(), M(20, 20), L(30, 30), Z()]).anchors();

    expect(anchors).toHaveLength(4);
    expect(anchors.items[0].subpathStart).toBe(true);
    expect(anchors.items[1].subpathStart).toBe(false);
    expect(anchors.items[2].subpathStart).toBe(true);
    expect(anchors.items[3].subpathStart).toBe(false);
    expect(anchors.items[2]).toMatchObject({ point: { x: 20, y: 20 } });
  });

  test('M C C Z の直線 close では開始アンカーの incoming が null になる', () => {
    // 最後の C(...,6,6) が M(0,0) と一致しない → 直線 close
    const anchors = new Path([M(0, 0), C(1, 1, 2, 2, 3, 3), C(4, 4, 5, 5, 6, 6), Z()]).anchors();
    expect(anchors.items[0].incomingHandle).toBeNull();
    expect(anchors.items[0].coincidentClosingCmdIndex).toBeNull();
  });

  test('M C Z の単一曲線 close では 1 アンカーが両ハンドルを保持する', () => {
    // M と単一 C で形成される閉ループ。C の to が M と一致するので、anchor は
    // 1 個 (= start anchor) になり、両端ハンドル (incoming/outgoing) ともに
    // 同じ C 命令の c2/c1 を指す。
    const anchors = new Path([M(0, 0), C(10, 0, 10, 20, 0, 0), Z()]).anchors();
    expect(anchors).toHaveLength(1);
    expect(anchors.items[0].point).toEqual({ x: 0, y: 0 });
    expect(anchors.items[0].subpathStart).toBe(true);
    expect(anchors.items[0].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 1 });
    expect(anchors.items[0].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 1 });
    expect(anchors.items[0].coincidentClosingCmdIndex).toBe(1);
  });
});

// ── Path.moveAnchor ─────────────────────────────────────────────────────

describe('Path.moveAnchor', () => {
  test('直線端点を移動できる', () => {
    const result = new Path([M(0, 0), L(10, 0), L(5, 10), Z()]).moveAnchor(1, 3, -2);

    expect(result.commands[1]).toEqual(L(13, -2));
    expect(result.commands[0]).toEqual(M(0, 0));
    expect(result.commands[2]).toEqual(L(5, 10));
    expect(result.commands[3]).toEqual(Z());
  });

  test('三次ベジェのアンカー移動でアンカーと付属ハンドルが追従する', () => {
    const result = new Path([M(0, 0), C(1, 2, 3, 4, 5, 5), C(6, 7, 8, 9, 10, 10), Z()]).moveAnchor(
      1,
      10,
      -5,
    );

    expect(result.commands[1]).toEqual(C(1, 2, 13, -1, 15, 0));
    expect(result.commands[2]).toEqual(C(16, 2, 8, 9, 10, 10));
    expect(result.commands[0]).toEqual(M(0, 0));
    expect(result.commands[3]).toEqual(Z());
  });

  test('閉曲線 (曲線 close) の M 移動で M.to + 前後ハンドル + 最後 C.to が同期する', () => {
    // 最後の C が M(0,0) で閉じる semantic。M を (2,3) 動かすと:
    //  - M.to が (2,3) に移動
    //  - 開始アンカーの outgoing (= 最初の C の c1) が追従
    //  - 開始アンカーの incoming (= 最後の C の c2) が追従
    //  - 最後の C の to も (0,0)→(2,3) に同期 (coincidentClosingCmdIndex 経由)
    const result = new Path([M(0, 0), C(1, 2, 3, 4, 5, 5), C(6, 7, 8, 9, 0, 0), Z()]).moveAnchor(
      0,
      2,
      3,
    );

    expect(result.commands[0]).toEqual(M(2, 3));
    expect(result.commands[1]).toEqual(C(3, 5, 3, 4, 5, 5));
    // 最後 C: c1 不変、c2 追従 (incoming)、to 追従 (coincident close)
    expect(result.commands[2]).toEqual(C(6, 7, 10, 12, 2, 3));
  });

  test('immutability: 変化したコマンドだけ新規生成し他は同一参照を保つ', () => {
    const cmd0 = M(0, 0);
    const cmd1 = L(10, 0);
    const cmd2 = L(5, 10);
    const cmd3 = Z();
    const cmds = [cmd0, cmd1, cmd2, cmd3];

    const result = new Path(cmds).moveAnchor(1, 1, 1);

    expect(result.commands).not.toBe(cmds);
    expect(result.commands[0]).toBe(cmd0);
    expect(result.commands[2]).toBe(cmd2);
    expect(result.commands[3]).toBe(cmd3);
    expect(result.commands[1]).not.toBe(cmd1);
    expect(result.commands[1]).toEqual(L(11, 1));
  });

  test('範囲外の anchorIndex なら no-op (内容不変の新 Path)', () => {
    const cmds: PathCommand[] = [M(0, 0), L(10, 0)];
    const original = new Path(cmds);
    const result = original.moveAnchor(99, 5, 5);
    expect(result.commands).toEqual(cmds);
    expect(result).not.toBe(original);
  });
});

// ── 回帰フィクスチャ ────────────────────────────────────────────────────

describe('回帰: 擬似「O」グリフ (4点閉曲線)', () => {
  const cmds: PathCommand[] = [
    M(50, 0),
    C(77.6, 0, 100, 22.4, 100, 50),
    C(100, 77.6, 77.6, 100, 50, 100),
    C(22.4, 100, 0, 77.6, 0, 50),
    C(0, 22.4, 22.4, 0, 50, 0),
    Z(),
  ];

  test('アンカー数 = 4 になる (closed curve の重複起点を 1 個にマージする)', () => {
    // O は top/right/bottom/left の 4 隅。最後の C が top に戻ってくるが、
    // 重複 anchor は extract されない (Z 処理でマージ)。
    const anchors = new Path(cmds).anchors();
    expect(anchors).toHaveLength(4);
    // 開始アンカー: 両ハンドル + coincident closing index
    expect(anchors.items[0].point).toEqual({ x: 50, y: 0 });
    expect(anchors.items[0].subpathStart).toBe(true);
    expect(anchors.items[0].outgoingHandle).toEqual({ kind: 'C-c1', cmdIndex: 1 });
    expect(anchors.items[0].incomingHandle).toEqual({ kind: 'C-c2', cmdIndex: 4 });
    expect(anchors.items[0].coincidentClosingCmdIndex).toBe(4);
  });

  test('Top (M) を下に 20px 移動でき周辺ハンドルと最後 C.to が同期する', () => {
    const result = new Path(cmds).moveAnchor(0, 0, 20);

    expect(result.commands[0]).toEqual(M(50, 20));
    // outgoing handle (1番目 C の c1) が追従
    const r1 = result.commands[1];
    expect(r1.type).toBe('C');
    if (r1.type !== 'C') throw new Error('expected C');
    expect(r1.c1).toEqual({ x: 77.6, y: 20 });
    // C[0] の c2 と to は不変
    expect(r1.c2).toEqual({ x: 100, y: 22.4 });
    expect(r1.to).toEqual({ x: 100, y: 50 });
    // 最後 C: c2 (incoming) 追従 + to (coincident close) も追従
    const r4 = result.commands[4];
    expect(r4.type).toBe('C');
    if (r4.type !== 'C') throw new Error('expected C');
    expect(r4.c1).toEqual({ x: 0, y: 22.4 }); // 不変 (前 anchor の outgoing)
    expect(r4.c2).toEqual({ x: 22.4, y: 20 }); // 追従 (start anchor incoming)
    expect(r4.to).toEqual({ x: 50, y: 20 }); // 追従 (coincident close, M と同期)
    // C[2], C[3] 完全不変 (同一参照)
    expect(result.commands[2]).toBe(cmds[2]);
    expect(result.commands[3]).toBe(cmds[3]);
  });
});

// ── Path.moveHandle ─────────────────────────────────────────────────────

describe('Path.moveHandle', () => {
  test('C コマンドの incoming ハンドル移動で c2 のみ変わる', () => {
    const handle: HandleRef = { kind: 'C-c2', cmdIndex: 1 };
    const result = new Path([M(0, 0), C(1, 2, 3, 4, 5, 5), Z()]).moveHandle(handle, 10, -5);

    expect(result.commands[1]).toEqual(C(1, 2, 13, -1, 5, 5));
  });

  test('C コマンドの outgoing ハンドル移動で c1 のみ変わる', () => {
    const handle: HandleRef = { kind: 'C-c1', cmdIndex: 2 };
    const result = new Path([M(0, 0), C(1, 2, 3, 4, 5, 5), C(6, 7, 8, 9, 10, 10), Z()]).moveHandle(
      handle,
      -3,
      4,
    );

    expect(result.commands[2]).toEqual(C(3, 11, 8, 9, 10, 10));
    // アンカー・他コマンド不変
    expect(result.commands[0]).toEqual(M(0, 0));
    expect(result.commands[1]).toEqual(C(1, 2, 3, 4, 5, 5));
  });

  test('Q コマンドの共有制御点を移動できる', () => {
    const handle: HandleRef = { kind: 'Q-c', cmdIndex: 1 };
    const result = new Path([M(0, 0), Q(5, 10, 10, 0), Z()]).moveHandle(handle, 2, -3);

    expect(result.commands[1]).toEqual(Q(7, 7, 10, 0));
  });

  test('immutability: 変更コマンドだけ新規生成し他は同一参照を保つ', () => {
    const cmd0 = M(0, 0);
    const cmd1 = C(1, 2, 3, 4, 5, 5);
    const cmd2 = Z();
    const cmds = [cmd0, cmd1, cmd2];

    const handle: HandleRef = { kind: 'C-c2', cmdIndex: 1 };
    const result = new Path(cmds).moveHandle(handle, 1, 1);

    expect(result.commands).not.toBe(cmds);
    expect(result.commands[0]).toBe(cmd0); // 同一参照
    expect(result.commands[2]).toBe(cmd2); // 同一参照
    expect(result.commands[1]).not.toBe(cmd1); // 新規
    expect(result.commands[1]).toEqual(C(1, 2, 4, 5, 5, 5));
  });

  test('ハンドル移動後もアンカー座標は不変になる', () => {
    const cmds: PathCommand[] = [M(0, 0), C(1, 2, 3, 4, 5, 5), C(6, 7, 8, 9, 10, 10), Z()];
    const original = new Path(cmds);
    const anchorsBefore = original.anchors();

    // incoming ハンドルを移動
    const handle: HandleRef = { kind: 'C-c2', cmdIndex: 1 };
    const result = original.moveHandle(handle, 100, 100);
    const anchorsAfter = result.anchors();

    // アンカー座標は全て同一
    for (let i = 0; i < anchorsBefore.length; i++) {
      expect(anchorsAfter.items[i].point).toEqual(anchorsBefore.items[i].point);
    }
  });

  test('範囲外の cmdIndex なら no-op (内容不変の新 Path)', () => {
    const cmds: PathCommand[] = [M(0, 0), L(10, 0)];
    const handle: HandleRef = { kind: 'C-c1', cmdIndex: 99 };
    const result = new Path(cmds).moveHandle(handle, 5, 5);
    expect(result.commands).toEqual(cmds);
  });

  test('kind とコマンド種別が不一致ならコマンドを変えない', () => {
    // C-c1 を L に対して適用 (= 何もしない)
    const handle: HandleRef = { kind: 'C-c1', cmdIndex: 1 };
    const result = new Path([M(0, 0), L(10, 0)]).moveHandle(handle, 5, 5);
    expect(result.commands[1]).toEqual(L(10, 0));
  });
});

// ── Path.segmentStart ───────────────────────────────────────────────────

describe('Path.segmentStart', () => {
  test('C コマンドの始点として直前の M を返す', () => {
    const path = new Path([M(10, 20), C(1, 2, 3, 4, 5, 6), Z()]);
    expect(path.segmentStart(1)).toEqual({ x: 10, y: 20 });
  });

  test('2 番目の C の始点として直前の C の終点を返す', () => {
    const path = new Path([M(0, 0), C(1, 2, 3, 4, 5, 5), C(6, 7, 8, 9, 10, 10), Z()]);
    expect(path.segmentStart(2)).toEqual({ x: 5, y: 5 });
  });

  test('M の前なら null を返す', () => {
    expect(new Path([M(0, 0)]).segmentStart(0)).toBeNull();
  });
});

// ── Path.splitSegment ───────────────────────────────────────────────────

describe('Path.splitSegment', () => {
  test('C を t=0.5 で分割するとコマンド数が 1 増える', () => {
    const result = new Path([M(0, 0), C(30, 0, 70, 100, 100, 100), Z()]).splitSegment(1, 0.5);
    expect(result).not.toBeNull();
    expect(result!.commands).toHaveLength(4); // M, C, C, Z

    // 分割点は元の曲線の t=0.5 上にある (t=0.5 で B = (50, 50))
    const r1 = result!.commands[1];
    expect(r1.type).toBe('C');
    if (r1.type !== 'C') throw new Error('expected C');
    expect(r1.to.x).toBeCloseTo(50);
    expect(r1.to.y).toBeCloseTo(50);
    // 第2セグメントの終点は元の終点
    const r2 = result!.commands[2];
    expect(r2.type).toBe('C');
    if (r2.type !== 'C') throw new Error('expected C');
    expect(r2.to).toEqual({ x: 100, y: 100 });
  });

  test('C を t=0 / t=1 で分割すると退化して始点 / 終点に新アンカーを置く', () => {
    const path = new Path([M(0, 0), C(10, 0, 20, 0, 30, 0), Z()]);

    const r0 = path.splitSegment(1, 0)!;
    expect(r0.commands).toHaveLength(4);
    const r0_1 = r0.commands[1];
    if (r0_1.type !== 'C') throw new Error('expected C');
    expect(r0_1.to.x).toBeCloseTo(0);
    expect(r0_1.to.y).toBeCloseTo(0);

    const r1 = path.splitSegment(1, 1)!;
    expect(r1.commands).toHaveLength(4);
    const r1_1 = r1.commands[1];
    if (r1_1.type !== 'C') throw new Error('expected C');
    expect(r1_1.to.x).toBeCloseTo(30);
    expect(r1_1.to.y).toBeCloseTo(0);
  });

  test('L を t=0.5 で分割すると 2 つの L になる', () => {
    const result = new Path([M(0, 0), L(10, 10), Z()]).splitSegment(1, 0.5)!;
    expect(result.commands).toHaveLength(4);
    expect(result.commands[1]).toEqual(L(5, 5));
    expect(result.commands[2]).toEqual(L(10, 10));
  });

  test('Q を t=0.5 で分割すると 2 つの Q になる', () => {
    const result = new Path([M(0, 0), Q(5, 10, 10, 0), Z()]).splitSegment(1, 0.5)!;
    expect(result.commands).toHaveLength(4);
    expect(result.commands[1].type).toBe('Q');
    expect(result.commands[2].type).toBe('Q');
    // 第2セグメントの終点は元の終点
    const r2 = result.commands[2];
    if (r2.type !== 'Q') throw new Error('expected Q');
    expect(r2.to).toEqual({ x: 10, y: 0 });
  });

  test('分割対象以外のコマンドは不変になる', () => {
    const cmd0 = M(0, 0);
    const cmd2 = Z();
    const cmds = [cmd0, L(10, 10), cmd2];
    const result = new Path(cmds).splitSegment(1, 0.5)!;
    expect(result.commands[0]).toBe(cmd0);
    expect(result.commands[3]).toBe(cmd2);
  });
});

// ── Path.removeAnchor ───────────────────────────────────────────────────

describe('Path.removeAnchor', () => {
  test('中間アンカーを削除すると前後の C が直線 L に置換される', () => {
    const result = new Path([
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      Z(),
    ]).removeAnchor(1)!; // anchor (5,5) を削除
    expect(result.commands).toHaveLength(3); // M, L, Z
    expect(result.commands[0]).toEqual(M(0, 0));
    expect(result.commands[1]).toEqual(L(10, 10)); // 直線化
    expect(result.commands[2]).toEqual(Z());
  });

  test('最後のアンカー (Z 直前) を削除するとコマンドを除去するだけになる', () => {
    const cmds: PathCommand[] = [
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      C(11, 12, 13, 14, 15, 15),
      Z(),
    ];
    const result = new Path(cmds).removeAnchor(3)!; // 最後の (15,15) を削除
    expect(result.commands).toHaveLength(4); // M, C, C, Z
    expect(result.commands[0]).toEqual(M(0, 0));
    expect(result.commands[2]).toEqual(cmds[2]); // 2番目の C は不変
    expect(result.commands[3]).toEqual(Z());
  });

  test('M アンカーを削除すると次のアンカーが新 M になる', () => {
    const result = new Path([
      M(0, 0),
      C(1, 2, 3, 4, 5, 5),
      C(6, 7, 8, 9, 10, 10),
      Z(),
    ]).removeAnchor(0)!;
    expect(result.commands).toHaveLength(3); // M, C, Z
    expect(result.commands[0]).toEqual(M(5, 5)); // 新 M は次のアンカー位置
    expect(result.commands[2]).toEqual(Z());
  });

  test('サブパスのアンカーが 2 以下なら削除を拒否して null を返す', () => {
    const result = new Path([M(0, 0), L(10, 10), Z()]).removeAnchor(0);
    expect(result).toBeNull();
  });

  test('範囲外 anchorIndex なら null を返す', () => {
    const result = new Path([M(0, 0), L(10, 10), Z()]).removeAnchor(99);
    expect(result).toBeNull();
  });

  test('擬似 O グリフから中間アンカーを削除できる', () => {
    const cmds: PathCommand[] = [
      M(50, 0),
      C(77.6, 0, 100, 22.4, 100, 50),
      C(100, 77.6, 77.6, 100, 50, 100),
      C(22.4, 100, 0, 77.6, 0, 50),
      C(0, 22.4, 22.4, 0, 50, 0),
      Z(),
    ];
    const result = new Path(cmds).removeAnchor(2)!; // (50, 100) を削除
    expect(result.commands).toHaveLength(5); // M, C, L, C, Z
    expect(result.commands[0]).toEqual(M(50, 0));
    expect(result.commands[1]).toEqual(cmds[1]); // 第1 C は不変
    expect(result.commands[2]).toEqual(L(0, 50)); // (50,100)→(0,50) が直線化
    expect(result.commands[3]).toEqual(cmds[4]); // 最後の C は不変
  });
});

// ── Path.handlePoint ────────────────────────────────────────────────────

describe('Path.handlePoint', () => {
  test('C-c1 / C-c2 / Q-c それぞれの Point を返す', () => {
    const cubicPath = new Path([M(0, 0), C(1, 2, 3, 4, 5, 6)]);
    expect(cubicPath.handlePoint({ kind: 'C-c1', cmdIndex: 1 })).toEqual({ x: 1, y: 2 });
    expect(cubicPath.handlePoint({ kind: 'C-c2', cmdIndex: 1 })).toEqual({ x: 3, y: 4 });

    const quadPath = new Path([M(0, 0), Q(7, 8, 9, 10)]);
    expect(quadPath.handlePoint({ kind: 'Q-c', cmdIndex: 1 })).toEqual({ x: 7, y: 8 });
  });

  test('kind とコマンド種別が不一致なら null を返す', () => {
    const linePath = new Path([M(0, 0), L(0, 0)]);
    expect(linePath.handlePoint({ kind: 'C-c1', cmdIndex: 1 })).toBeNull();

    const cubicPath = new Path([M(0, 0), C(1, 2, 3, 4, 5, 6)]);
    expect(cubicPath.handlePoint({ kind: 'Q-c', cmdIndex: 1 })).toBeNull();
  });
});
