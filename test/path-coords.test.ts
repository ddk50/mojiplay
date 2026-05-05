// 座標変換 (path/coords.ts) の単体テスト。
//
// fabric の TMat2D 互換の 6 要素タプル [a, b, c, d, tx, ty] を扱う。
// (x, y) → (a*x + c*y + tx, b*x + d*y + ty) という 2x3 アフィン。

type Point = { readonly x: number; readonly y: number };
type Mat2x3 = readonly [number, number, number, number, number, number];

interface PathTransform {
  readonly pathMatrix: Mat2x3;
  readonly pathOffset: Point;
  readonly viewportMatrix: Mat2x3;
}

const {
  applyMatrix, applyMatrixToDelta, invertMatrix,
  pathLocalToScreen, screenToPathLocal, worldDeltaToPathLocalDelta,
} = require('../src/core/path/coords') as {
  applyMatrix:               (p: Point, m: Mat2x3) => Point;
  applyMatrixToDelta:        (d: Point, m: Mat2x3) => Point;
  invertMatrix:              (m: Mat2x3) => Mat2x3;
  pathLocalToScreen:         (p: Point, t: PathTransform) => { sx: number; sy: number };
  screenToPathLocal:         (p: Point, t: PathTransform) => Point;
  worldDeltaToPathLocalDelta:(d: Point, m: Mat2x3) => Point;
};

const IDENT: Mat2x3 = [1, 0, 0, 1, 0, 0];

function expectClose(p: Point, ex: number, ey: number): void {
  expect(p.x).toBeCloseTo(ex);
  expect(p.y).toBeCloseTo(ey);
}

describe('applyMatrix', () => {
  test('identity is no-op', () => {
    expectClose(applyMatrix({ x: 3, y: 7 }, IDENT), 3, 7);
  });

  test('translation', () => {
    expectClose(applyMatrix({ x: 3, y: 7 }, [1, 0, 0, 1, 10, 20]), 13, 27);
  });

  test('uniform scale', () => {
    expectClose(applyMatrix({ x: 3, y: 7 }, [2, 0, 0, 2, 0, 0]), 6, 14);
  });

  test('90deg rotation', () => {
    // 反時計回り 90°: (x, y) → (-y, x). a=cosθ=0, b=sinθ=1, c=-sinθ=-1, d=cosθ=0
    expectClose(applyMatrix({ x: 3, y: 7 }, [0, 1, -1, 0, 0, 0]), -7, 3);
  });

  test('translate + scale composes (scale then translate)', () => {
    expectClose(applyMatrix({ x: 3, y: 7 }, [2, 0, 0, 2, 10, 20]), 16, 34);
  });
});

describe('applyMatrixToDelta', () => {
  test('ignores translation', () => {
    expectClose(applyMatrixToDelta({ x: 3, y: 7 }, [1, 0, 0, 1, 100, 200]), 3, 7);
  });

  test('applies linear part', () => {
    expectClose(applyMatrixToDelta({ x: 3, y: 7 }, [2, 0, 0, 2, 100, 200]), 6, 14);
  });
});

describe('invertMatrix', () => {
  test('identity is self-inverse', () => {
    // -0 と 0 を区別しない比較 (1/-0 などの負ゼロ伝播を許容)
    const inv = invertMatrix(IDENT);
    inv.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1, 0, 0][i]));
  });

  test('inverse of translation', () => {
    const inv = invertMatrix([1, 0, 0, 1, 10, 20]);
    expectClose(applyMatrix({ x: 0, y: 0 }, inv), -10, -20);
  });

  test('A * A^-1 = identity for arbitrary matrix', () => {
    const m: Mat2x3 = [1.5, 0.3, -0.2, 2.0, 17, -42];
    const inv = invertMatrix(m);
    const p = { x: 11, y: -5 };
    const round = applyMatrix(applyMatrix(p, m), inv);
    expectClose(round, p.x, p.y);
  });

  test('singular matrix throws', () => {
    expect(() => invertMatrix([0, 0, 0, 0, 0, 0])).toThrow();
  });
});

describe('pathLocalToScreen / screenToPathLocal', () => {
  test('round-trips through identity transforms', () => {
    const t: PathTransform = {
      pathMatrix:     IDENT,
      pathOffset:     { x: 0, y: 0 },
      viewportMatrix: IDENT,
    };
    const local = { x: 50, y: 80 };
    const screen = pathLocalToScreen(local, t);
    expect(screen).toEqual({ sx: 50, sy: 80 });
    expectClose(screenToPathLocal({ x: screen.sx, y: screen.sy }, t), 50, 80);
  });

  test('pathOffset shifts screen position', () => {
    // local 100 with pathOffset 30 means world = 70 (then viewport identity)
    const t: PathTransform = {
      pathMatrix:     IDENT,
      pathOffset:     { x: 30, y: 40 },
      viewportMatrix: IDENT,
    };
    const screen = pathLocalToScreen({ x: 100, y: 100 }, t);
    expect(screen).toEqual({ sx: 70, sy: 60 });
  });

  test('viewportMatrix scales/translates screen output', () => {
    // 2x zoom + (5, 10) pan
    const t: PathTransform = {
      pathMatrix:     IDENT,
      pathOffset:     { x: 0, y: 0 },
      viewportMatrix: [2, 0, 0, 2, 5, 10],
    };
    const screen = pathLocalToScreen({ x: 100, y: 100 }, t);
    expect(screen).toEqual({ sx: 205, sy: 210 });
  });

  test('pathMatrix translation moves origin', () => {
    // pathMatrix translates (local - pathOffset) by (200, 300)
    const t: PathTransform = {
      pathMatrix:     [1, 0, 0, 1, 200, 300],
      pathOffset:     { x: 0, y: 0 },
      viewportMatrix: IDENT,
    };
    const screen = pathLocalToScreen({ x: 0, y: 0 }, t);
    expect(screen).toEqual({ sx: 200, sy: 300 });
  });

  test('round-trip through arbitrary transform stack', () => {
    const t: PathTransform = {
      pathMatrix:     [1.4, 0.2, -0.1, 1.3, 50, 60],
      pathOffset:     { x: 12, y: 17 },
      viewportMatrix: [0.8, 0, 0, 0.8, 100, 200],
    };
    const local = { x: 70, y: -30 };
    const screen = pathLocalToScreen(local, t);
    const back  = screenToPathLocal({ x: screen.sx, y: screen.sy }, t);
    expectClose(back, local.x, local.y);
  });
});

describe('worldDeltaToPathLocalDelta', () => {
  test('with identity pathMatrix, delta is unchanged', () => {
    expectClose(worldDeltaToPathLocalDelta({ x: 5, y: -3 }, IDENT), 5, -3);
  });

  test('with 2x scale pathMatrix, world delta is halved in local', () => {
    expectClose(worldDeltaToPathLocalDelta({ x: 10, y: 20 }, [2, 0, 0, 2, 999, -999]), 5, 10);
  });

  test('with 90deg rotation pathMatrix, delta is rotated -90deg', () => {
    // pathMatrix の 90° 逆 = -90°: (x, y) → (y, -x)
    expectClose(worldDeltaToPathLocalDelta({ x: 3, y: 7 }, [0, 1, -1, 0, 0, 0]), 7, -3);
  });

  test('translation in pathMatrix is irrelevant for delta', () => {
    expectClose(worldDeltaToPathLocalDelta({ x: 3, y: 7 }, [1, 0, 0, 1, 999, 999]), 3, 7);
  });
});

export {};
