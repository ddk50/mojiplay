// Anchors 値オブジェクト: Path から抽出されたアンカー列。
//
// 設計:
//   - immutable wrapper (PathAnchor[] を encapsulate)
//   - Anchors / PathAnchor の関係 = Path / PathCommand と同じ階層
//     (= 集合 + その操作)
//   - 「Anchors 集合に対する操作」(= 抽出、subpath 境界探索、iteration) は
//     ここに集約。types.ts は data shape のみ。
//
// CA 上は Entity / pure 値オブジェクト。fabric / DOM 不知。

import type { Point, PathAnchor, PathCommand } from './types';

const COINCIDENT_EPSILON = 1e-6;

function pointsEqual(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < COINCIDENT_EPSILON &&
         Math.abs(a.y - b.y) < COINCIDENT_EPSILON;
}

export class Anchors {
  constructor(readonly items: ReadonlyArray<PathAnchor>) {}

  get length(): number { return this.items.length; }

  at(idx: number): PathAnchor | undefined { return this.items[idx]; }

  [Symbol.iterator](): IterableIterator<PathAnchor> {
    return this.items[Symbol.iterator]();
  }
  entries(): IterableIterator<[number, PathAnchor]> {
    return this.items.entries();
  }

  /**
   * 指定アンカーが属する subpath の [start, end) 範囲 (anchor index) を返す。
   * Path.removeAnchor が「サブパス内のアンカー数下限 (= 2)」判定に使う。
   * idx が範囲外なら null。
   */
  subpathRange(idx: number): { start: number; end: number } | null {
    if (idx < 0 || idx >= this.items.length) return null;
    let start = idx;
    while (start > 0 && !this.items[start].subpathStart) start--;
    let end = idx + 1;
    while (end < this.items.length && !this.items[end].subpathStart) end++;
    return { start, end };
  }

  /**
   * PathCommand 配列から Anchors を抽出する factory。
   *
   * 主な semantic:
   *   - M / L / C / Q ごとにアンカーを生成
   *   - C / Q では「直前アンカーの outgoingHandle」「自身の incomingHandle」を
   *     互いに紐付ける
   *   - Z で曲線 close する場合 (= 最後の curve.to が M.to と一致する) は、
   *     重複アンカーをマージし、開始アンカーに incomingHandle と
   *     coincidentClosingCmdIndex を記録 (M を動かしたとき curve.to も同期するため)
   */
  static fromCommands(commands: ReadonlyArray<PathCommand>): Anchors {
    const anchors: PathAnchor[] = [];
    let subpathStartIdx = -1;

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      switch (cmd.type) {
        case 'M':
          subpathStartIdx = anchors.length;
          anchors.push({
            cmdIndex: i,
            point: cmd.to,
            incomingHandle: null,
            outgoingHandle: null,
            subpathStart: true,
            coincidentClosingCmdIndex: null,
          });
          break;

        case 'L':
          anchors.push({
            cmdIndex: i,
            point: cmd.to,
            incomingHandle: null,
            outgoingHandle: null,
            subpathStart: false,
            coincidentClosingCmdIndex: null,
          });
          break;

        case 'C': {
          const prev = anchors.length > 0 ? anchors[anchors.length - 1] : null;
          if (prev) prev.outgoingHandle = { kind: 'C-c1', cmdIndex: i };
          anchors.push({
            cmdIndex: i,
            point: cmd.to,
            incomingHandle: { kind: 'C-c2', cmdIndex: i },
            outgoingHandle: null,
            subpathStart: false,
            coincidentClosingCmdIndex: null,
          });
          break;
        }

        case 'Q': {
          const prev = anchors.length > 0 ? anchors[anchors.length - 1] : null;
          if (prev) prev.outgoingHandle = { kind: 'Q-c', cmdIndex: i };
          anchors.push({
            cmdIndex: i,
            point: cmd.to,
            incomingHandle: { kind: 'Q-c', cmdIndex: i },
            outgoingHandle: null,
            subpathStart: false,
            coincidentClosingCmdIndex: null,
          });
          break;
        }

        case 'Z': {
          // 閉パスの semantic 的 2 ケース:
          //  (A) 最後の curve (C/Q) が M 点に戻ってくる (= fontkit が出す典型形):
          //      curve で閉じている。start anchor.incoming を curve 制御点に設定し、
          //      最後の curve の to は M 点と座標重複なので「重複した最終アンカー」
          //      を pop する (= visual 重複の防止)。M と最後の curve の to は同位置
          //      なので、M を動かすときは curve の to も同期する必要があるため
          //      coincidentClosingCmdIndex に最後の curve の cmd index を記録。
          //  (B) 最後の curve / 直線 が M 点に戻らない (= Z で straight に閉じる):
          //      開始アンカーには curve incoming は無い。何もしない。
          if (subpathStartIdx >= 0 && subpathStartIdx < anchors.length) {
            const startAnchor = anchors[subpathStartIdx];
            const lastCmd = i > 0 ? commands[i - 1] : null;
            if (lastCmd && (lastCmd.type === 'C' || lastCmd.type === 'Q') &&
                pointsEqual(lastCmd.to, startAnchor.point)) {
              // ケース (A)
              if (lastCmd.type === 'C') {
                startAnchor.incomingHandle = { kind: 'C-c2', cmdIndex: i - 1 };
              } else {
                startAnchor.incomingHandle = { kind: 'Q-c', cmdIndex: i - 1 };
              }
              const lastAnchorIdx = anchors.length - 1;
              if (lastAnchorIdx > subpathStartIdx &&
                  anchors[lastAnchorIdx].cmdIndex === i - 1) {
                anchors.pop();
                startAnchor.coincidentClosingCmdIndex = i - 1;
              }
            }
            // ケース (B) では何もしない (Z は直線 close なので start anchor の
            // incoming は null のまま)
          }
          break;
        }

        default:
          cmd satisfies never;
      }
    }

    return new Anchors(anchors);
  }
}
