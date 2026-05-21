// zoom-canvas-by-wheel use case の test。
//
// 検証方針:
//   - computeZoomFromWheel は pure function なので fabric / state なしで単体 test
//   - zoomCanvasByWheel は real State + fabric stub で integration test (zoomToPoint
//     が呼ばれる + onZoomChanged callback が発火する)

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import {
  computeZoomFromWheel,
  zoomCanvasByWheel,
} from '../src/window/presenter/zoom-canvas-by-wheel';
import { State } from '../src/window/presenter/state';
import { NullFontProvider } from './fakes';

describe('computeZoomFromWheel (pure)', () => {
  test('deltaY=0 で zoom が変わらない', () => {
    expect(computeZoomFromWheel(1.5, 0)).toBeCloseTo(1.5);
  });

  test('deltaY 正で zoom が縮小 (Photoshop 流: ホイール手前 = 縮小)', () => {
    const r = computeZoomFromWheel(1.0, 100);
    expect(r).toBeLessThan(1.0);
  });

  test('deltaY 負で zoom が拡大', () => {
    const r = computeZoomFromWheel(1.0, -100);
    expect(r).toBeGreaterThan(1.0);
  });

  test('上限 20 にクランプ (極端に大きな負 delta)', () => {
    expect(computeZoomFromWheel(10, -100000)).toBe(20);
  });

  test('下限 0.1 にクランプ (極端に大きな正 delta)', () => {
    expect(computeZoomFromWheel(0.5, 100000)).toBe(0.1);
  });

  test('カスタム bounds で min/max を上書きできる', () => {
    expect(computeZoomFromWheel(1, -100000, { min: 0.5, max: 5 })).toBe(5);
    expect(computeZoomFromWheel(1, 100000, { min: 0.5, max: 5 })).toBe(0.5);
  });
});

describe('zoomCanvasByWheel (orchestration)', () => {
  function setup(): { state: State; canvas: FakeFabricCanvas; zoomChangedCount: number } {
    const canvas = new FakeFabricCanvas();
    const state = new State(canvas as never, new NullFontProvider());
    return { state, canvas, zoomChangedCount: 0 };
  }

  test('state.zoomToPoint を計算済 zoom + focal で呼ぶ', () => {
    const { state, canvas } = setup();
    let zoomChangedCalled = 0;
    zoomCanvasByWheel(state, -100, { x: 250, y: 150 }, () => {
      zoomChangedCalled++;
    });
    expect(canvas.getZoom()).toBeCloseTo(computeZoomFromWheel(1, -100), 5);
    expect(canvas.getLastZoomFocal()).toEqual({ x: 250, y: 150 });
    expect(zoomChangedCalled).toBe(1);
  });

  test('複数回連続で呼ぶと累積する (= state.getZoom() 経由で次の prevZoom を読む)', () => {
    const { state, canvas } = setup();
    zoomCanvasByWheel(state, -100, { x: 0, y: 0 }, () => {});
    const after1 = canvas.getZoom();
    zoomCanvasByWheel(state, -100, { x: 0, y: 0 }, () => {});
    const after2 = canvas.getZoom();
    expect(after2).toBeGreaterThan(after1);
  });

  test('clamp 上限で saturate しても onZoomChanged は毎回呼ばれる', () => {
    const { state } = setup();
    let count = 0;
    for (let i = 0; i < 20; i++) {
      zoomCanvasByWheel(state, -100000, { x: 0, y: 0 }, () => {
        count++;
      });
    }
    expect(count).toBe(20);
    expect(state.getZoom()).toBe(20); // upper bound
  });
});
