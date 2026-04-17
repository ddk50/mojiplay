// パスアンカーポイント抽出・移動の単体テスト
//
// ── SVG パスコマンド早見表 ──────────────────────────────────────────────
//
// fabric.Path.path は以下の絶対座標コマンドタプルの配列:
//
//   ['M', x, y]                      MoveTo       サブパス開始点へ移動
//   ['L', x, y]                      LineTo       直線を引く
//   ['C', x1, y1, x2, y2, x, y]     CurveTo      三次ベジェ曲線
//       x1,y1 = 始点側制御点 (前のアンカーの outgoing handle)
//       x2,y2 = 終点側制御点 (このアンカーの incoming handle)
//       x,y   = 終点 (アンカー)
//   ['Q', x1, y1, x, y]             QuadCurveTo  二次ベジェ曲線
//       x1,y1 = 制御点 (前後の両アンカーに共有)
//       x,y   = 終点 (アンカー)
//   ['Z']                            ClosePath    サブパス開始点 (直前の M) に戻る
//
// ── テスト方針 ──────────────────────────────────────────────────────────
//
// extractAnchors: パスコマンド配列 → アンカー一覧の変換が正しいか
// moveAnchorRigid: 指定アンカーと付属ハンドルが (dx,dy) 移動し、
//                  他のコマンドは不変 (immutable) であることを確認

type PathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z'];

interface HandleRef {
  readonly cmdIndex: number;
  readonly paramIndices: readonly [number, number];
}

interface PathAnchor {
  readonly cmdIndex: number;
  readonly x: number;
  readonly y: number;
  incomingHandle: HandleRef | null;
  outgoingHandle: HandleRef | null;
  readonly subpathStart: boolean;
}

const { extractAnchors, moveAnchorRigid, moveHandle, evalCubicAt, evalQuadAt, getSegmentStart, splitSegment, removeAnchor } =
  require('../src/renderer/path-anchors') as {
    extractAnchors: (path: PathCommand[]) => PathAnchor[];
    moveAnchorRigid: (path: ReadonlyArray<PathCommand>, anchorIndex: number, dx: number, dy: number) => PathCommand[];
    moveHandle: (path: ReadonlyArray<PathCommand>, handle: HandleRef, dx: number, dy: number) => PathCommand[];
    evalCubicAt: (p0x: number, p0y: number, c1x: number, c1y: number, c2x: number, c2y: number, p3x: number, p3y: number, t: number) => [number, number];
    evalQuadAt: (p0x: number, p0y: number, c1x: number, c1y: number, p2x: number, p2y: number, t: number) => [number, number];
    getSegmentStart: (path: ReadonlyArray<PathCommand>, cmdIndex: number) => [number, number] | null;
    splitSegment: (path: ReadonlyArray<PathCommand>, cmdIndex: number, t: number) => PathCommand[];
    removeAnchor: (path: ReadonlyArray<PathCommand>, anchorIndex: number) => PathCommand[];
  };

// ── extractAnchors ──────────────────────────────────────────────────────

describe('extractAnchors', () => {
  test('直線ポリゴン (M L L Z) → アンカー3個、ハンドル全て null', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 5, 10],
      ['Z'],
    ];
    const anchors = extractAnchors(path);

    expect(anchors).toHaveLength(3);

    expect(anchors[0].x).toBe(0);
    expect(anchors[0].y).toBe(0);
    expect(anchors[0].subpathStart).toBe(true);
    expect(anchors[0].incomingHandle).toBeNull();
    expect(anchors[0].outgoingHandle).toBeNull();

    expect(anchors[1].x).toBe(10);
    expect(anchors[1].y).toBe(0);
    expect(anchors[1].subpathStart).toBe(false);

    expect(anchors[2].x).toBe(5);
    expect(anchors[2].y).toBe(10);
    expect(anchors[2].subpathStart).toBe(false);
  });

  test('三次ベジェ (M C C Z) → 中間アンカーのハンドルが正しく紐付く', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['C', 6, 7, 8, 9, 10, 10],
      ['Z'],
    ];
    const anchors = extractAnchors(path);

    expect(anchors).toHaveLength(3);

    expect(anchors[0]).toMatchObject({ x: 0, y: 0, subpathStart: true });
    expect(anchors[0].outgoingHandle).toEqual({ cmdIndex: 1, paramIndices: [1, 2] });
    expect(anchors[0].incomingHandle).toEqual({ cmdIndex: 2, paramIndices: [3, 4] });

    expect(anchors[1]).toMatchObject({ x: 5, y: 5 });
    expect(anchors[1].incomingHandle).toEqual({ cmdIndex: 1, paramIndices: [3, 4] });
    expect(anchors[1].outgoingHandle).toEqual({ cmdIndex: 2, paramIndices: [1, 2] });

    expect(anchors[2]).toMatchObject({ x: 10, y: 10 });
    expect(anchors[2].incomingHandle).toEqual({ cmdIndex: 2, paramIndices: [3, 4] });
    expect(anchors[2].outgoingHandle).toBeNull();
  });

  test('二次ベジェ混在 (M Q L) → Q のハンドル紐付け', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['Q', 5, 10, 10, 0],
      ['L', 15, 5],
    ];
    const anchors = extractAnchors(path);

    expect(anchors).toHaveLength(3);
    expect(anchors[0].outgoingHandle).toEqual({ cmdIndex: 1, paramIndices: [1, 2] });
    expect(anchors[1]).toMatchObject({ x: 10, y: 0 });
    expect(anchors[1].incomingHandle).toEqual({ cmdIndex: 1, paramIndices: [1, 2] });
    expect(anchors[2].incomingHandle).toBeNull();
    expect(anchors[2].outgoingHandle).toBeNull();
  });

  test('2 サブパス (M L Z M L Z) → 4 アンカー、subpathStart 2個', () => {
    const path: PathCommand[] = [
      ['M', 0, 0], ['L', 10, 10], ['Z'],
      ['M', 20, 20], ['L', 30, 30], ['Z'],
    ];
    const anchors = extractAnchors(path);

    expect(anchors).toHaveLength(4);
    expect(anchors[0].subpathStart).toBe(true);
    expect(anchors[1].subpathStart).toBe(false);
    expect(anchors[2].subpathStart).toBe(true);
    expect(anchors[3].subpathStart).toBe(false);
    expect(anchors[2]).toMatchObject({ x: 20, y: 20 });
  });

  test('閉曲線の M の incoming (M C C Z)', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 1, 2, 2, 3, 3],
      ['C', 4, 4, 5, 5, 6, 6],
      ['Z'],
    ];
    const anchors = extractAnchors(path);
    expect(anchors[0].incomingHandle).toEqual({ cmdIndex: 2, paramIndices: [3, 4] });
  });
});

// ── moveAnchorRigid ─────────────────────────────────────────────────────

describe('moveAnchorRigid', () => {
  test('直線端点の移動', () => {
    const path: PathCommand[] = [
      ['M', 0, 0], ['L', 10, 0], ['L', 5, 10], ['Z'],
    ];
    const result = moveAnchorRigid(path, 1, 3, -2);

    expect(result[1]).toEqual(['L', 13, -2]);
    expect(result[0]).toEqual(['M', 0, 0]);
    expect(result[2]).toEqual(['L', 5, 10]);
    expect(result[3]).toEqual(['Z']);
  });

  test('三次ベジェのアンカー移動 (アンカー + 付属ハンドル追従)', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['C', 6, 7, 8, 9, 10, 10],
      ['Z'],
    ];
    const result = moveAnchorRigid(path, 1, 10, -5);

    expect(result[1]).toEqual(['C', 1, 2, 13, -1, 15, 0]);
    expect(result[2]).toEqual(['C', 16, 2, 8, 9, 10, 10]);
    expect(result[0]).toEqual(['M', 0, 0]);
    expect(result[3]).toEqual(['Z']);
  });

  test('閉曲線の M 移動 → 直前 C の incoming handle も追従', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['C', 6, 7, 8, 9, 10, 10],
      ['Z'],
    ];
    const result = moveAnchorRigid(path, 0, 2, 3);

    expect(result[0]).toEqual(['M', 2, 3]);
    expect(result[1]).toEqual(['C', 3, 5, 3, 4, 5, 5]);
    expect(result[2]).toEqual(['C', 6, 7, 10, 12, 10, 10]);
  });

  test('immutability — 変化したタプルだけ新規、他は同一参照', () => {
    const cmd0: PathCommand = ['M', 0, 0];
    const cmd1: PathCommand = ['L', 10, 0];
    const cmd2: PathCommand = ['L', 5, 10];
    const cmd3: PathCommand = ['Z'];
    const path = [cmd0, cmd1, cmd2, cmd3];

    const result = moveAnchorRigid(path, 1, 1, 1);

    expect(result).not.toBe(path);
    expect(result[0]).toBe(cmd0);
    expect(result[2]).toBe(cmd2);
    expect(result[3]).toBe(cmd3);
    expect(result[1]).not.toBe(cmd1);
    expect(result[1]).toEqual(['L', 11, 1]);
  });

  test('範囲外の anchorIndex → 元配列のコピーを返す', () => {
    const path: PathCommand[] = [['M', 0, 0], ['L', 10, 0]];
    const result = moveAnchorRigid(path, 99, 5, 5);
    expect(result).toEqual(path);
    expect(result).not.toBe(path);
  });
});

// ── 回帰フィクスチャ ────────────────────────────────────────────────────

describe('回帰: 擬似「O」グリフ (4点閉曲線)', () => {
  const path: PathCommand[] = [
    ['M', 50, 0],
    ['C', 77.6, 0, 100, 22.4, 100, 50],
    ['C', 100, 77.6, 77.6, 100, 50, 100],
    ['C', 22.4, 100, 0, 77.6, 0, 50],
    ['C', 0, 22.4, 22.4, 0, 50, 0],
    ['Z'],
  ];

  test('アンカー数 = 5', () => {
    expect(extractAnchors(path)).toHaveLength(5);
  });

  test('Top (M) を下に 20px 移動', () => {
    const result = moveAnchorRigid(path, 0, 0, 20);

    expect(result[0]).toEqual(['M', 50, 20]);
    // outgoing handle
    expect((result[1] as any)[1]).toBe(77.6);
    expect((result[1] as any)[2]).toBe(20);
    // C[0] endpoint/incoming 不変
    expect((result[1] as any).slice(3)).toEqual([100, 22.4, 100, 50]);
    // incoming handle (last C)
    expect((result[4] as any)[3]).toBe(22.4);
    expect((result[4] as any)[4]).toBe(20);
    // C[2], C[3] 完全不変
    expect(result[2]).toBe(path[2]);
    expect(result[3]).toBe(path[3]);
  });
});

// ── moveHandle ──────────────────────────────────────────────────────────

describe('moveHandle', () => {
  test('C コマンドの incoming ハンドル移動 → params [3,4] のみ変化', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['Z'],
    ];
    const handle: HandleRef = { cmdIndex: 1, paramIndices: [3, 4] };
    const result = moveHandle(path, handle, 10, -5);

    expect(result[1]).toEqual(['C', 1, 2, 13, -1, 5, 5]);
  });

  test('C コマンドの outgoing ハンドル移動 → params [1,2] のみ変化', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['C', 6, 7, 8, 9, 10, 10],
      ['Z'],
    ];
    const handle: HandleRef = { cmdIndex: 2, paramIndices: [1, 2] };
    const result = moveHandle(path, handle, -3, 4);

    expect(result[2]).toEqual(['C', 3, 11, 8, 9, 10, 10]);
    // アンカー・他コマンド不変
    expect(result[0]).toEqual(['M', 0, 0]);
    expect(result[1]).toEqual(['C', 1, 2, 3, 4, 5, 5]);
  });

  test('Q コマンドの共有制御点移動', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['Q', 5, 10, 10, 0],
      ['Z'],
    ];
    const handle: HandleRef = { cmdIndex: 1, paramIndices: [1, 2] };
    const result = moveHandle(path, handle, 2, -3);

    expect(result[1]).toEqual(['Q', 7, 7, 10, 0]);
  });

  test('immutability — 変更タプルだけ新規、他は同一参照', () => {
    const cmd0: PathCommand = ['M', 0, 0];
    const cmd1: PathCommand = ['C', 1, 2, 3, 4, 5, 5];
    const cmd2: PathCommand = ['Z'];
    const path = [cmd0, cmd1, cmd2];

    const handle: HandleRef = { cmdIndex: 1, paramIndices: [3, 4] };
    const result = moveHandle(path, handle, 1, 1);

    expect(result).not.toBe(path);
    expect(result[0]).toBe(cmd0);   // 同一参照
    expect(result[2]).toBe(cmd2);   // 同一参照
    expect(result[1]).not.toBe(cmd1); // 新規タプル
    expect(result[1]).toEqual(['C', 1, 2, 4, 5, 5, 5]);
  });

  test('アンカー座標は不変', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['C', 6, 7, 8, 9, 10, 10],
      ['Z'],
    ];
    const anchorsBefore = extractAnchors(path);

    // incoming ハンドルを移動
    const handle: HandleRef = { cmdIndex: 1, paramIndices: [3, 4] };
    const result = moveHandle(path, handle, 100, 100);
    const anchorsAfter = extractAnchors(result);

    // アンカー座標は全て同一
    for (let i = 0; i < anchorsBefore.length; i++) {
      expect(anchorsAfter[i].x).toBe(anchorsBefore[i].x);
      expect(anchorsAfter[i].y).toBe(anchorsBefore[i].y);
    }
  });

  test('範囲外の cmdIndex → 元配列のコピーを返す', () => {
    const path: PathCommand[] = [['M', 0, 0], ['L', 10, 0]];
    const handle: HandleRef = { cmdIndex: 99, paramIndices: [1, 2] };
    const result = moveHandle(path, handle, 5, 5);
    expect(result).toEqual(path);
    expect(result).not.toBe(path);
  });
});

// ── evalCubicAt / evalQuadAt ────────────────────────────────────────────

describe('evalCubicAt', () => {
  test('t=0 → 始点, t=1 → 終点', () => {
    expect(evalCubicAt(0, 0, 10, 20, 30, 40, 50, 50, 0)).toEqual([0, 0]);
    expect(evalCubicAt(0, 0, 10, 20, 30, 40, 50, 50, 1)).toEqual([50, 50]);
  });

  test('t=0.5 の直線 → 中点', () => {
    // 制御点が始点-終点の直線上にある場合、曲線も直線
    const [x, y] = evalCubicAt(0, 0, 10, 0, 20, 0, 30, 0, 0.5);
    expect(x).toBeCloseTo(15);
    expect(y).toBeCloseTo(0);
  });
});

describe('evalQuadAt', () => {
  test('t=0 → 始点, t=1 → 終点', () => {
    expect(evalQuadAt(0, 0, 5, 10, 10, 0, 0)).toEqual([0, 0]);
    expect(evalQuadAt(0, 0, 5, 10, 10, 0, 1)).toEqual([10, 0]);
  });
});

// ── getSegmentStart ─────────────────────────────────────────────────────

describe('getSegmentStart', () => {
  test('C コマンドの始点 = 直前の M', () => {
    const path: PathCommand[] = [['M', 10, 20], ['C', 1, 2, 3, 4, 5, 6], ['Z']];
    expect(getSegmentStart(path, 1)).toEqual([10, 20]);
  });

  test('2番目の C の始点 = 直前の C の終点', () => {
    const path: PathCommand[] = [
      ['M', 0, 0], ['C', 1, 2, 3, 4, 5, 5], ['C', 6, 7, 8, 9, 10, 10], ['Z'],
    ];
    expect(getSegmentStart(path, 2)).toEqual([5, 5]);
  });

  test('M の前 → null', () => {
    const path: PathCommand[] = [['M', 0, 0]];
    expect(getSegmentStart(path, 0)).toBeNull();
  });
});

// ── splitSegment ────────────────────────────────────────────────────────

describe('splitSegment', () => {
  test('C を t=0.5 で分割 → コマンド数が 1 増加', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 30, 0, 70, 100, 100, 100],
      ['Z'],
    ];
    const result = splitSegment(path, 1, 0.5);
    expect(result).toHaveLength(4); // M, C, C, Z

    // 分割点は元の曲線の t=0.5 上にある
    const [sx, sy] = evalCubicAt(0, 0, 30, 0, 70, 100, 100, 100, 0.5);
    expect((result[1] as any)[5]).toBeCloseTo(sx);
    expect((result[1] as any)[6]).toBeCloseTo(sy);
    // 第2セグメントの終点は元の終点
    expect((result[2] as any)[5]).toBe(100);
    expect((result[2] as any)[6]).toBe(100);
  });

  test('C を t=0 / t=1 で分割 → 退化 (始点/終点に新アンカー)', () => {
    const path: PathCommand[] = [
      ['M', 0, 0], ['C', 10, 0, 20, 0, 30, 0], ['Z'],
    ];
    const r0 = splitSegment(path, 1, 0);
    expect(r0).toHaveLength(4);
    expect((r0[1] as any)[5]).toBeCloseTo(0);
    expect((r0[1] as any)[6]).toBeCloseTo(0);

    const r1 = splitSegment(path, 1, 1);
    expect(r1).toHaveLength(4);
    expect((r1[1] as any)[5]).toBeCloseTo(30);
    expect((r1[1] as any)[6]).toBeCloseTo(0);
  });

  test('L を t=0.5 で分割 → 2 つの L', () => {
    const path: PathCommand[] = [['M', 0, 0], ['L', 10, 10], ['Z']];
    const result = splitSegment(path, 1, 0.5);
    expect(result).toHaveLength(4);
    expect(result[1]).toEqual(['L', 5, 5]);
    expect(result[2]).toEqual(['L', 10, 10]);
  });

  test('Q を t=0.5 で分割 → 2 つの Q', () => {
    const path: PathCommand[] = [['M', 0, 0], ['Q', 5, 10, 10, 0], ['Z']];
    const result = splitSegment(path, 1, 0.5);
    expect(result).toHaveLength(4);
    expect(result[1][0]).toBe('Q');
    expect(result[2][0]).toBe('Q');
    // 第2セグメントの終点は元の終点
    expect((result[2] as any)[3]).toBe(10);
    expect((result[2] as any)[4]).toBe(0);
  });

  test('他のコマンドは不変', () => {
    const cmd0: PathCommand = ['M', 0, 0];
    const cmd2: PathCommand = ['Z'];
    const path = [cmd0, ['L', 10, 10] as PathCommand, cmd2];
    const result = splitSegment(path, 1, 0.5);
    expect(result[0]).toBe(cmd0);
    expect(result[3]).toBe(cmd2);
  });
});

// ── removeAnchor ────────────────────────────────────────────────────────

describe('removeAnchor', () => {
  test('中間アンカー削除 → 直線 L に置換', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['C', 6, 7, 8, 9, 10, 10],
      ['Z'],
    ];
    const result = removeAnchor(path, 1); // anchor (5,5) を削除
    expect(result).toHaveLength(3); // M, L, Z
    expect(result[0]).toEqual(['M', 0, 0]);
    expect(result[1]).toEqual(['L', 10, 10]); // 直線化
    expect(result[2]).toEqual(['Z']);
  });

  test('最後のアンカー削除 (Z 直前) → コマンド除去のみ', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['C', 6, 7, 8, 9, 10, 10],
      ['C', 11, 12, 13, 14, 15, 15],
      ['Z'],
    ];
    const result = removeAnchor(path, 3); // 最後の (15,15) を削除
    expect(result).toHaveLength(4); // M, C, C, Z
    expect(result[0]).toEqual(['M', 0, 0]);
    expect(result[2]).toEqual(path[2]); // 2番目の C は不変
    expect(result[3]).toEqual(['Z']);
  });

  test('M アンカー削除 → 次のアンカーが新 M', () => {
    const path: PathCommand[] = [
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['C', 6, 7, 8, 9, 10, 10],
      ['Z'],
    ];
    const result = removeAnchor(path, 0);
    expect(result).toHaveLength(3); // M, C, Z
    expect(result[0]).toEqual(['M', 5, 5]); // 新 M は次のアンカー位置
    expect(result[2]).toEqual(['Z']);
  });

  test('サブパスのアンカーが 2 以下 → 操作拒否', () => {
    const path: PathCommand[] = [['M', 0, 0], ['L', 10, 10], ['Z']];
    const result = removeAnchor(path, 0);
    expect(result).toEqual(path);
    expect(result).not.toBe(path);
  });

  test('範囲外 → 元配列コピー', () => {
    const path: PathCommand[] = [['M', 0, 0], ['L', 10, 10], ['Z']];
    const result = removeAnchor(path, 99);
    expect(result).toEqual(path);
  });

  test('擬似 O グリフから中間アンカー削除', () => {
    const path: PathCommand[] = [
      ['M', 50, 0],
      ['C', 77.6, 0, 100, 22.4, 100, 50],
      ['C', 100, 77.6, 77.6, 100, 50, 100],
      ['C', 22.4, 100, 0, 77.6, 0, 50],
      ['C', 0, 22.4, 22.4, 0, 50, 0],
      ['Z'],
    ];
    const result = removeAnchor(path, 2); // (50, 100) を削除
    expect(result).toHaveLength(5); // M, C, L, C, Z
    expect(result[0]).toEqual(['M', 50, 0]);
    expect(result[1]).toEqual(path[1]); // 第1 C は不変
    expect(result[2]).toEqual(['L', 0, 50]); // (50,100)→(0,50) が直線化
    expect(result[3]).toEqual(path[4]); // 最後の C は不変
  });
});

export {};
