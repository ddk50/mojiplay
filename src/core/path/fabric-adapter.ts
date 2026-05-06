// fabric.js 生タプル ↔ 内部 ADT (PathCommand) 境界変換 (純粋関数)
//
// fabric.Path.path は ['M', x, y] のようなタプル配列で、
// ./anchors.ts は { type: 'M', to: {x, y} } のオブジェクト ADT で動作する。
// このモジュールは両者の橋渡しを行う唯一の場所。

import type { PathCommand } from './types';

// fabric.js が扱う生タプル形式
export type FabricPathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z'];

export function fromFabricPath(raw: ReadonlyArray<ReadonlyArray<unknown>>): PathCommand[] {
  const out: PathCommand[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const t = r[0];
    switch (t) {
      case 'M':
        out.push({ type: 'M', to: { x: r[1] as number, y: r[2] as number } });
        break;
      case 'L':
        out.push({ type: 'L', to: { x: r[1] as number, y: r[2] as number } });
        break;
      case 'C':
        out.push({
          type: 'C',
          c1: { x: r[1] as number, y: r[2] as number },
          c2: { x: r[3] as number, y: r[4] as number },
          to: { x: r[5] as number, y: r[6] as number },
        });
        break;
      case 'Q':
        out.push({
          type: 'Q',
          c:  { x: r[1] as number, y: r[2] as number },
          to: { x: r[3] as number, y: r[4] as number },
        });
        break;
      case 'Z':
        out.push({ type: 'Z' });
        break;
      default:
        throw new Error(`unknown fabric path command: ${String(t)}`);
    }
  }
  return out;
}

export function toFabricPath(path: ReadonlyArray<PathCommand>): FabricPathCommand[] {
  const out: FabricPathCommand[] = [];
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    switch (c.type) {
      case 'M': out.push(['M', c.to.x, c.to.y]); break;
      case 'L': out.push(['L', c.to.x, c.to.y]); break;
      case 'C': out.push(['C', c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.to.x, c.to.y]); break;
      case 'Q': out.push(['Q', c.c.x, c.c.y, c.to.x, c.to.y]); break;
      case 'Z': out.push(['Z']); break;
      default: c satisfies never;
    }
  }
  return out;
}

