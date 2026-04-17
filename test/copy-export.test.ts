// PNG エクスポートのユニットテスト
//
// ── テスト方針 ──────────────────────────────────────────────────────────
//
// fabric.Object.prototype.toCanvasElement は内部で DOM <canvas> を生成するため
// Node.js 環境では本物の fabric オブジェクトを使えない。代わりに fabric の
// toCanvasElement の振る舞い (options.multiplier を読んで canvas サイズを決定)
// を模倣するモックで検証する。
//
// 型システムが positional arg ミス (toCanvasElement(10)) をコンパイルエラーで
// 防ぐため、テストでは主に「正しい multiplier で正しいサイズの canvas が返るか」
// という振る舞い (出力サイズ) を検証する。

interface ExportResult {
  dataUrl: string;
  width: number;
  height: number;
}

const { exportObjectToPngDataUrl } =
  require('../src/renderer/copy-export') as {
    exportObjectToPngDataUrl: (obj: any, multiplier: number) => ExportResult;
  };

// fabric.Object.prototype.toCanvasElement の振る舞いを模倣するモック。
// options.multiplier を読んで canvas サイズを決定する。
// もし数値を直接渡された場合 (旧バグ)、options.multiplier は undefined → 1 倍。
function createMockObject(w: number, h: number) {
  const calls: any[] = [];
  return {
    calls,
    toCanvasElement(options: { multiplier?: number }) {
      calls.push(options);
      const m = options?.multiplier ?? 1;
      return {
        width: Math.ceil(w * m),
        height: Math.ceil(h * m),
        toDataURL: (format: string) => `data:${format};base64,MOCK`,
      };
    },
  };
}

describe('exportObjectToPngDataUrl', () => {
  test('multiplier=10 で canvas サイズが 10 倍になる', () => {
    const mock = createMockObject(50, 40);
    const result = exportObjectToPngDataUrl(mock, 10);

    expect(result.width).toBe(500);
    expect(result.height).toBe(400);
  });

  test('multiplier=1 (等倍) で元サイズ', () => {
    const mock = createMockObject(100, 80);
    const result = exportObjectToPngDataUrl(mock, 1);

    expect(result.width).toBe(100);
    expect(result.height).toBe(80);
  });

  test('dataUrl が data:image/png で始まる', () => {
    const mock = createMockObject(10, 10);
    const result = exportObjectToPngDataUrl(mock, 5);

    expect(result.dataUrl).toMatch(/^data:image\/png/);
  });

  test('toCanvasElement に { multiplier } オブジェクトが渡される', () => {
    // 今回のバグの核心: positional arg (数値) ではなく options オブジェクトで
    // multiplier が渡されることを確認。型システムでもガードされているが、
    // 型が壊れた場合 (as any キャスト等) の安全網。
    const mock = createMockObject(30, 20);
    exportObjectToPngDataUrl(mock, 7);

    expect(mock.calls).toHaveLength(1);
    const arg = mock.calls[0];
    expect(typeof arg).toBe('object');
    expect(arg).not.toBeNull();
    expect(arg.multiplier).toBe(7);
  });

  test('multiplier=0 → throw', () => {
    const mock = createMockObject(10, 10);
    expect(() => exportObjectToPngDataUrl(mock, 0)).toThrow('invalid multiplier');
  });

  test('multiplier=NaN → throw', () => {
    const mock = createMockObject(10, 10);
    expect(() => exportObjectToPngDataUrl(mock, NaN)).toThrow('invalid multiplier');
  });

  test('multiplier=-5 → throw', () => {
    const mock = createMockObject(10, 10);
    expect(() => exportObjectToPngDataUrl(mock, -5)).toThrow('invalid multiplier');
  });

  test('multiplier=Infinity → throw', () => {
    const mock = createMockObject(10, 10);
    expect(() => exportObjectToPngDataUrl(mock, Infinity)).toThrow('invalid multiplier');
  });
});

export {};
