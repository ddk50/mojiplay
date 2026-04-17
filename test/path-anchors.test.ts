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

const { extractAnchors, moveAnchorRigid } =
  require('../src/renderer/path-anchors') as {
    extractAnchors: (path: PathCommand[]) => PathAnchor[];
    moveAnchorRigid: (path: ReadonlyArray<PathCommand>, anchorIndex: number, dx: number, dy: number) => PathCommand[];
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

export {};
