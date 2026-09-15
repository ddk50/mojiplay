// 2 次ベジェ (Q) → 3 次ベジェ (C) の次数上げ (degree elevation)。
//
// このアプリの outlined path の正規形は C (3 次) に統一する。理由:
//   - Q は制御点 1 個を前後 2 アンカーで共有するため、ハンドル IF が
//     「1 本動かすと両隣のセグメントが同時に変形する」形になる。
//   - C は各アンカーが in / out の独立した 2 本のハンドルを持つ (Illustrator 型)。
//   - fontkit は TrueType (glyf) フォントを Q で、CFF/OTF を C で返す。フォントの
//     内部形式が UI に漏れないよう、アウトライン化 / ロード時にここで正規化する。
//
// 数学: Q(p0, q, p1) は C(p0, p0 + 2/3(q−p0), p1 + 2/3(q−p1), p1) と曲線が完全一致
// (損失なし)。形状が変わらないので bbox / pathOffset も変わらない。

import type { Point, PathCommand } from './types';

function lerp23(from: Point, toward: Point): Point {
  return {
    x: from.x + ((toward.x - from.x) * 2) / 3,
    y: from.y + ((toward.y - from.y) * 2) / 3,
  };
}

/**
 * 全ての Q コマンドを等価な C コマンドに置換した新しい配列を返す。
 * Q が無ければ同内容のコピー。M / L / C / Z はそのまま。
 *
 * 現在点の追跡規則は Path.segmentStart と同じ (Z は subpath 先頭 M に戻る)。
 */
export function elevateQuadraticsToCubic(commands: ReadonlyArray<PathCommand>): PathCommand[] {
  const out: PathCommand[] = [];
  let current: Point | null = null;
  let subpathStart: Point | null = null;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        current = cmd.to;
        subpathStart = cmd.to;
        out.push(cmd);
        break;
      case 'L':
      case 'C':
        current = cmd.to;
        out.push(cmd);
        break;
      case 'Q': {
        // 直前の現在点が無い (M 無しで Q が来る不正形) 場合は制御点を始点扱い。
        const p0 = current ?? cmd.c;
        out.push({
          type: 'C',
          c1: lerp23(p0, cmd.c),
          c2: lerp23(cmd.to, cmd.c),
          to: cmd.to,
        });
        current = cmd.to;
        break;
      }
      case 'Z':
        current = subpathStart;
        out.push(cmd);
        break;
      default:
        cmd satisfies never;
    }
  }
  return out;
}

/** 配列に Q が 1 つでも含まれるか。正規化の要否判定用。 */
export function hasQuadratic(commands: ReadonlyArray<PathCommand>): boolean {
  return commands.some((c) => c.type === 'Q');
}
