// Path 値オブジェクト + path-level 操作の全ロジック。
//
// 設計:
//   - immutable wrapper (PathCommand[] を encapsulate)
//   - 編集メソッド (moveAnchor / moveHandle / removeAnchor / splitSegment) は
//     新しい Path を返し、自身は変更しない
//   - 拒否系 (removeAnchor / splitSegment) は適用不可なら null を返す
//   - private helper はファイル内 module-private (他から import しない)
//
// CA 上は Entity / pure 値オブジェクト。fabric / DOM 不知。

import type { Point, PathCommand, HandleRef } from './types';
import { Anchors } from './anchors';

// ─── Path 値オブジェクト ───────────────────────────────────────────────────

export class Path {
  constructor(readonly commands: ReadonlyArray<PathCommand>) {}

  /** アンカー (+ ハンドル参照) 一覧を抽出 (Anchors 値オブジェクト)。 */
  anchors(): Anchors {
    return Anchors.fromCommands(this.commands);
  }

  /**
   * `cmdIndex` のセグメントの始点 (= 直前 anchor の point) を返す。
   * cmdIndex が最初の M より前の場合は null。pen tool で 1/3 デフォルトの
   * 制御点を計算する用途。
   */
  segmentStart(cmdIndex: number): Point | null {
    return getSegmentStart(this.commands, cmdIndex);
  }

  /**
   * HandleRef が指す制御点の Point を返す。kind とコマンド種別が一致しなければ
   * null。overlay の handle 描画用。
   */
  handlePoint(ref: HandleRef): Point | null {
    return getHandlePoint(this.commands[ref.cmdIndex], ref);
  }

  /**
   * アンカーを (dx, dy) 移動した新 Path。アンカーの incoming/outgoing ハンドルや
   * coincident closing curve も同期して動く (剛体移動)。範囲外は silent no-op。
   */
  moveAnchor(idx: number, dx: number, dy: number): Path {
    return new Path(moveAnchorRigid(this.commands, idx, dx, dy));
  }

  /**
   * ハンドル (C-c1 / C-c2 / Q-c) を (dx, dy) 移動した新 Path。kind 不一致 /
   * 範囲外は silent no-op。
   */
  moveHandle(handle: HandleRef, dx: number, dy: number): Path {
    return new Path(moveSingleHandle(this.commands, handle, dx, dy));
  }

  /**
   * アンカーを削除した新 Path。サブパスのアンカー数下限 (= 2) を下回る削除は
   * 拒否され null を返す。
   */
  removeAnchor(idx: number): Path | null {
    const next = removeAnchorImpl(this.commands, idx);
    return next.length === this.commands.length ? null : new Path(next);
  }

  /**
   * 指定セグメントを t (0..1) で分割した新 Path。M / Z セグメントに対しては
   * 分割不可で null を返す。L→2L、Q→2Q、C→2C、退化 (t=0/t=1) でも分割。
   */
  splitSegment(cmdIndex: number, t: number): Path | null {
    const next = splitSegmentImpl(this.commands, cmdIndex, t);
    return next.length === this.commands.length ? null : new Path(next);
  }
}

// ─── private helpers (module-private) ─────────────────────────────────────

function getHandlePoint(cmd: PathCommand, ref: HandleRef): Point | null {
  switch (ref.kind) {
    case 'C-c1':
      return cmd.type === 'C' ? cmd.c1 : null;
    case 'C-c2':
      return cmd.type === 'C' ? cmd.c2 : null;
    case 'Q-c':
      return cmd.type === 'Q' ? cmd.c : null;
  }
}

function withHandleMoved(cmd: PathCommand, ref: HandleRef, dx: number, dy: number): PathCommand {
  switch (ref.kind) {
    case 'C-c1':
      if (cmd.type !== 'C') return cmd;
      return { ...cmd, c1: { x: cmd.c1.x + dx, y: cmd.c1.y + dy } };
    case 'C-c2':
      if (cmd.type !== 'C') return cmd;
      return { ...cmd, c2: { x: cmd.c2.x + dx, y: cmd.c2.y + dy } };
    case 'Q-c':
      if (cmd.type !== 'Q') return cmd;
      return { ...cmd, c: { x: cmd.c.x + dx, y: cmd.c.y + dy } };
  }
}

function withAnchorBodyMoved(cmd: PathCommand, dx: number, dy: number): PathCommand {
  switch (cmd.type) {
    case 'M':
      return { type: 'M', to: { x: cmd.to.x + dx, y: cmd.to.y + dy } };
    case 'L':
      return { type: 'L', to: { x: cmd.to.x + dx, y: cmd.to.y + dy } };
    case 'C':
      return { ...cmd, to: { x: cmd.to.x + dx, y: cmd.to.y + dy } };
    case 'Q':
      return { ...cmd, to: { x: cmd.to.x + dx, y: cmd.to.y + dy } };
    case 'Z':
      // anchor.cmdIndex は Anchors.fromCommands の仕様により M/L/C/Q のいずれか
      return cmd;
    default:
      return cmd satisfies never;
  }
}

function moveAnchorRigid(
  path: ReadonlyArray<PathCommand>,
  anchorIndex: number,
  dx: number, dy: number,
): PathCommand[] {
  const anchor = Anchors.fromCommands(path).at(anchorIndex);
  if (!anchor) return path.slice();

  const updates = new Map<number, PathCommand>();

  // アンカー本体を移動
  updates.set(anchor.cmdIndex, withAnchorBodyMoved(path[anchor.cmdIndex], dx, dy));

  // 曲線で閉じる subpath の開始アンカーを動かす場合、最後の curve の to も同期
  // して動かす (両者は座標重複しており、M を動かしたら curve の to もついていく
  // 必要があるため)。
  if (anchor.coincidentClosingCmdIndex !== null) {
    const ci = anchor.coincidentClosingCmdIndex;
    updates.set(ci, withAnchorBodyMoved(path[ci], dx, dy));
  }

  // 付属ハンドルを平行移動 (アンカー本体と同じコマンドを共有する場合があるため
  // 既存の更新結果を起点にして再更新する)
  if (anchor.incomingHandle) {
    const h = anchor.incomingHandle;
    const cur = updates.get(h.cmdIndex) ?? path[h.cmdIndex];
    updates.set(h.cmdIndex, withHandleMoved(cur, h, dx, dy));
  }
  if (anchor.outgoingHandle) {
    const h = anchor.outgoingHandle;
    const cur = updates.get(h.cmdIndex) ?? path[h.cmdIndex];
    updates.set(h.cmdIndex, withHandleMoved(cur, h, dx, dy));
  }

  const result: PathCommand[] = new Array(path.length);
  for (let i = 0; i < path.length; i++) {
    const u = updates.get(i);
    result[i] = u !== undefined ? u : path[i];
  }
  return result;
}

function moveSingleHandle(
  path: ReadonlyArray<PathCommand>,
  handle: HandleRef,
  dx: number, dy: number,
): PathCommand[] {
  const ci = handle.cmdIndex;
  if (ci < 0 || ci >= path.length) return path.slice();

  const cmd = path[ci];
  const updated = withHandleMoved(cmd, handle, dx, dy);

  const result: PathCommand[] = new Array(path.length);
  for (let i = 0; i < path.length; i++) {
    result[i] = i === ci ? updated : path[i];
  }
  return result;
}

function getSegmentStart(
  path: ReadonlyArray<PathCommand>, cmdIndex: number,
): Point | null {
  for (let i = cmdIndex - 1; i >= 0; i--) {
    const c = path[i];
    switch (c.type) {
      case 'M': return c.to;
      case 'L': return c.to;
      case 'C': return c.to;
      case 'Q': return c.to;
      case 'Z': break; // Z は始点情報を持たない、さらに前を探す
      default: c satisfies never;
    }
  }
  return null;
}

function splitSegmentImpl(
  path: ReadonlyArray<PathCommand>,
  cmdIndex: number,
  t: number,
): PathCommand[] {
  if (cmdIndex < 0 || cmdIndex >= path.length) return path.slice();

  const cmd = path[cmdIndex];
  const start = getSegmentStart(path, cmdIndex);
  if (!start) return path.slice();

  const p0 = start;
  let first: PathCommand;
  let second: PathCommand;

  switch (cmd.type) {
    case 'C': {
      const u = 1 - t;
      // De Casteljau level 1
      const q0x = u * p0.x   + t * cmd.c1.x;
      const q0y = u * p0.y   + t * cmd.c1.y;
      const q1x = u * cmd.c1.x + t * cmd.c2.x;
      const q1y = u * cmd.c1.y + t * cmd.c2.y;
      const q2x = u * cmd.c2.x + t * cmd.to.x;
      const q2y = u * cmd.c2.y + t * cmd.to.y;
      // level 2
      const r0x = u * q0x + t * q1x;
      const r0y = u * q0y + t * q1y;
      const r1x = u * q1x + t * q2x;
      const r1y = u * q1y + t * q2y;
      // level 3 — 分割点
      const sx = u * r0x + t * r1x;
      const sy = u * r0y + t * r1y;

      first  = { type: 'C', c1: { x: q0x, y: q0y }, c2: { x: r0x, y: r0y }, to: { x: sx, y: sy } };
      second = { type: 'C', c1: { x: r1x, y: r1y }, c2: { x: q2x, y: q2y }, to: cmd.to };
      break;
    }
    case 'Q': {
      const u = 1 - t;
      const q0x = u * p0.x   + t * cmd.c.x;
      const q0y = u * p0.y   + t * cmd.c.y;
      const q1x = u * cmd.c.x + t * cmd.to.x;
      const q1y = u * cmd.c.y + t * cmd.to.y;
      const sx = u * q0x + t * q1x;
      const sy = u * q0y + t * q1y;

      first  = { type: 'Q', c: { x: q0x, y: q0y }, to: { x: sx, y: sy } };
      second = { type: 'Q', c: { x: q1x, y: q1y }, to: cmd.to };
      break;
    }
    case 'L': {
      const sx = p0.x + t * (cmd.to.x - p0.x);
      const sy = p0.y + t * (cmd.to.y - p0.y);

      first  = { type: 'L', to: { x: sx, y: sy } };
      second = { type: 'L', to: cmd.to };
      break;
    }
    case 'M':
    case 'Z':
      return path.slice();
    default:
      return cmd satisfies never;
  }

  const result: PathCommand[] = [];
  for (let i = 0; i < path.length; i++) {
    if (i === cmdIndex) {
      result.push(first);
      result.push(second);
    } else {
      result.push(path[i]);
    }
  }
  return result;
}

function removeAnchorImpl(
  path: ReadonlyArray<PathCommand>,
  anchorIndex: number,
): PathCommand[] {
  const anchors = Anchors.fromCommands(path);
  const range = anchors.subpathRange(anchorIndex);
  if (!range) return path.slice();

  // アンカーが 2 以下になる削除は拒否
  if (range.end - range.start <= 2) return path.slice();

  const anchor = anchors.at(anchorIndex)!;
  const result: PathCommand[] = [];

  if (anchor.subpathStart) {
    // M アンカーの削除: 次のアンカーを新しい M にする
    const next = anchors.at(anchorIndex + 1)!;
    for (let i = 0; i < path.length; i++) {
      if (i === anchor.cmdIndex) {
        result.push({ type: 'M', to: next.point });
      } else if (i === next.cmdIndex) {
        // 次のアンカーへのコマンドをスキップ (M に置換済み)
        continue;
      } else {
        result.push(path[i]);
      }
    }
  } else {
    // 非 M アンカーの削除
    const subEnd = range.end;
    const hasNext = (anchorIndex + 1) < subEnd;
    const nextAnchor = hasNext ? anchors.at(anchorIndex + 1)! : null;
    const nextCmdIndex = nextAnchor ? nextAnchor.cmdIndex : -1;

    for (let i = 0; i < path.length; i++) {
      if (i === anchor.cmdIndex) {
        continue; // 削除
      } else if (hasNext && i === nextCmdIndex && nextAnchor) {
        result.push({ type: 'L', to: nextAnchor.point });
      } else {
        result.push(path[i]);
      }
    }
  }

  return result;
}
