// アウトライン位置計算の単体テスト
//
// ──────────────────────────────────────────────────────────────────────────
// 経緯メモ: なぜこのロジックが切り出されテストされているか
// ──────────────────────────────────────────────────────────────────────────
//
// Phase 1「アウトライン化」機能で、fabric.Text の位置から対応する fabric.Path の
// 位置を計算するロジックには 2 段階のバグがあり、デバッグが長引いた。以下にその
// 経緯を残す。
//
// ■ Bug 1: 座標の「基準」が勝手に変わるバグ (ActiveSelection 問題)
//
//   現象: 複数のテキストを選択した状態でアウトライン化すると、生成された図形が
//         画面の左上に大きく飛んでいってしまった。
//
//   原因: fabric.js の仕様。複数の図形を ActiveSelection (複数選択) にまとめて
//         いる間、各図形の .left/.top は「画面上の位置」ではなく「選択グループ
//         の中心からの相対的な位置」に一時的に書き換わる (_updateObjectsCoords)。
//         選択解除時 (discardActiveObject) に _restoreObjectsState が走って元の
//         画面座標に戻る。
//         我々のコードは選択解除せずに各文字の .left/.top を読んでいたため、
//         相対座標を画面座標と勘違いして計算 → パスがデタラメな位置に出ていた。
//
//   対策: 計算を始める前に一度 canvas.discardActiveObject() を呼び、fabric に
//         子オブジェクトの座標を画面座標に戻してもらってから計算するように
//         した (outlineSelection 先頭)。
//
//   テスト可能性: ✗ fabric との統合バグなので純粋関数テストでは再現不可。
//                 outlineSelection のコメントで重要性を明示している。
//
//
// ■ Bug 2: baseline の計算ミス (このファイルで守るリグレッション)
//
//   現象: 生成された図形が、元のテキストより少し (72pt のとき約 8.7px) 下に
//         ズレて表示されていた。
//
//   原因: 「テキストの上端 + フォントサイズ = baseline」という単純な式で baseline
//         位置を計算していた。実際には fabric.js 内部で、2 つの特殊な定数
//         _fontSizeMult=1.13 と _fontSizeFraction=0.222 を使って
//           baseline = ft.top + fontSize × _fontSizeMult × (1 - _fontSizeFraction)
//                    ≈ ft.top + fontSize × 0.879
//         の位置に baseline を置く。我々の式 (0.879 倍が無い) は fontSize の
//         0.121 倍分 (72pt で 8.7px) 下へ baseline がズレて計算されていた。
//
//   対策: fabric の内部定数をそのまま参照する式に修正。computeOutlinePathPosition
//         がその式の本体。fabric インスタンスに定数が無い場合のデフォルト値
//         (1.13 / 0.222) は純粋関数内で持つ。
//
//   テスト可能性: ✓ 純粋な算数なので本テストで守る。リグレッションテストは
//                 production ログから取った実値を使用。
//
// ──────────────────────────────────────────────────────────────────────────

import { computeOutlinePathPosition } from '../src/core/outline-position';

describe('computeOutlinePathPosition', () => {
  test('fabric デフォルト定数 (_fontSizeMult=1.13, _fontSizeFraction=0.222) で計算できる', () => {
    const r = computeOutlinePathPosition(
      { left: 100, top: 200, fontSize: 72 },
      { minX: 5, minY: -50 },
    );
    expect(r.left).toBe(105);
    expect(r.top).toBeCloseTo(213.29808, 3);
  });

  test('明示的な fontSizeMult / fontSizeFraction でデフォルトを上書きできる', () => {
    const r = computeOutlinePathPosition(
      { left: 0, top: 0, fontSize: 100, fontSizeMult: 1, fontSizeFraction: 0 },
      { minX: 10, minY: -40 },
    );
    expect(r.left).toBe(10);
    expect(r.top).toBe(60);
  });

  test('回帰: ft=(198,143), fontSize=72, "H" グリフ (production log 由来) を再現できる', () => {
    const r = computeOutlinePathPosition(
      { left: 198, top: 143, fontSize: 72 },
      { minX: 5.77, minY: -51.54 },
    );
    expect(r.left).toBeCloseTo(203.77, 1);
    expect(r.top).toBeCloseTo(154.76, 1);
  });

  test('descender のみのグリフ (bb.minY >= 0) でも baseline を同じ式で計算する', () => {
    const r = computeOutlinePathPosition(
      { left: 100, top: 100, fontSize: 72 },
      { minX: 5, minY: 0 },
    );
    expect(r.top).toBeCloseTo(163.29808, 3);
  });

  test('負の座標 (post-drag world coord) でも正しく計算できる', () => {
    const r = computeOutlinePathPosition(
      { left: -262.55, top: -41.18, fontSize: 72 },
      { minX: 5.77, minY: -51.54 },
    );
    expect(r.left).toBeCloseTo(-256.78, 1);
    expect(r.top).toBeCloseTo(-29.42192, 1);
  });

  test('fontSize=0 の degenerate でも NaN や例外を出さない', () => {
    const r = computeOutlinePathPosition(
      { left: 50, top: 50, fontSize: 0 },
      { minX: 0, minY: 0 },
    );
    expect(r.left).toBe(50);
    expect(r.top).toBe(50);
  });
});

