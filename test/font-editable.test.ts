// presenter/font-editable の判定 decision table。pure 関数なので stub 不要。

import { canEditFont, shouldDisableFontControls } from '../src/window/presenter/font-editable';

describe('canEditFont', () => {
  test('fontFamily を持つ text 系オブジェクトは true', () => {
    expect(canEditFont({ fontFamily: 'Arial' })).toBe(true);
  });

  test('fontFamily を持たない (outlined path 相当) は false', () => {
    expect(canEditFont({})).toBe(false);
  });

  test('fontFamily が空文字なら false', () => {
    expect(canEditFont({ fontFamily: '' })).toBe(false);
  });

  test('fontFamily が文字列以外なら false', () => {
    expect(canEditFont({ fontFamily: 42 })).toBe(false);
  });
});

describe('shouldDisableFontControls', () => {
  test('選択なしは enable 維持 (新規 IText の source of truth 保護)', () => {
    expect(shouldDisableFontControls([])).toBe(false);
  });

  test('outlined path のみの単一選択は disable', () => {
    expect(shouldDisableFontControls([{}])).toBe(true);
  });

  test('text の単一選択は enable', () => {
    expect(shouldDisableFontControls([{ fontFamily: 'Arial' }])).toBe(false);
  });

  test('outlined path のみの複数選択は disable', () => {
    expect(shouldDisableFontControls([{}, {}])).toBe(true);
  });

  test('text + outlined path の混在選択は enable (text に適用できる)', () => {
    expect(shouldDisableFontControls([{ fontFamily: 'Arial' }, {}])).toBe(false);
  });

  test('fontFamily が空文字だけの選択は disable', () => {
    expect(shouldDisableFontControls([{ fontFamily: '' }])).toBe(true);
  });
});
