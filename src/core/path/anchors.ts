// パスアンカーポイント抽出・移動ヘルパー (純粋関数)
//
// fabric.Path.path (コマンド配列) からアンカーポイントを抽出し、
// 個別アンカーの剛体移動 (アンカー + 付属ベジェハンドル) を行う。
// fabric / DOM 非依存で単体テスト可能。
//
// fabric.js 生タプル ↔ PathCommand の境界変換は ./fabric-adapter.ts。

import type { Point, PathCommand, HandleRef, PathAnchor } from './types';

// ── HandleRef → Point アクセサ ──────────────────────────────────────────

export function getHandlePoint(cmd: PathCommand, ref: HandleRef): Point | null {
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
      // anchor.cmdIndex は extractAnchors の仕様により M/L/C/Q のいずれか
      return cmd;
    default:
      return cmd satisfies never;
  }
}

// ── extractAnchors ──────────────────────────────────────────────────────

export function extractAnchors(path: ReadonlyArray<PathCommand>): PathAnchor[] {
  const anchors: PathAnchor[] = [];
  let subpathStartIdx = -1;

  for (let i = 0; i < path.length; i++) {
    const cmd = path[i];
    switch (cmd.type) {
      case 'M':
        subpathStartIdx = anchors.length;
        anchors.push({
          cmdIndex: i,
          point: cmd.to,
          incomingHandle: null,
          outgoingHandle: null,
          subpathStart: true,
        });
        break;

      case 'L':
        anchors.push({
          cmdIndex: i,
          point: cmd.to,
          incomingHandle: null,
          outgoingHandle: null,
          subpathStart: false,
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
        });
        break;
      }

      case 'Z': {
        // 閉パス: 直前コマンドが C/Q の場合、サブパス先頭 M の incomingHandle を設定
        if (subpathStartIdx >= 0 && subpathStartIdx < anchors.length) {
          const startAnchor = anchors[subpathStartIdx];
          const lastCmd = i > 0 ? path[i - 1] : null;
          if (lastCmd) {
            if (lastCmd.type === 'C') {
              startAnchor.incomingHandle = { kind: 'C-c2', cmdIndex: i - 1 };
            } else if (lastCmd.type === 'Q') {
              startAnchor.incomingHandle = { kind: 'Q-c', cmdIndex: i - 1 };
            }
          }
        }
        break;
      }

      default:
        cmd satisfies never;
    }
  }

  return anchors;
}

// ── moveAnchorRigid ─────────────────────────────────────────────────────
//
// 指定アンカー本体と付属ハンドル (incoming/outgoing) を (dx, dy) 平行移動。
// 変更されないコマンドは元の参照をそのまま返す (immutability 契約)。

export function moveAnchorRigid(
  path: ReadonlyArray<PathCommand>,
  anchorIndex: number,
  dx: number, dy: number,
): PathCommand[] {
  const anchors = extractAnchors(path);
  if (anchorIndex < 0 || anchorIndex >= anchors.length) {
    return path.slice();
  }

  const anchor = anchors[anchorIndex];
  const updates = new Map<number, PathCommand>();

  // アンカー本体を移動
  updates.set(anchor.cmdIndex, withAnchorBodyMoved(path[anchor.cmdIndex], dx, dy));

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

// ── moveHandle ──────────────────────────────────────────────────────────
//
// HandleRef が指す制御点のみを (dx, dy) 移動する。
// アンカー本体や反対側ハンドルには一切触れない。

export function moveHandle(
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

// ── ベジェ曲線評価 ──────────────────────────────────────────────────────

export function evalCubicAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + ttt * p3.y,
  };
}

export function evalQuadAt(p0: Point, c1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * c1.y + t * t * p2.y,
  };
}

// ── セグメント始点取得 ──────────────────────────────────────────────────

export function getSegmentStart(
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

// ── セグメント分割 (De Casteljau) ───────────────────────────────────────

export function splitSegment(
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

// ── アンカーポイント削除 ────────────────────────────────────────────────
//
// 指定アンカーを削除し、後続セグメントを直線 (L) に置換する。
// サブパス内のアンカー数が 2 以下になる場合は操作を拒否する。

export function removeAnchor(
  path: ReadonlyArray<PathCommand>,
  anchorIndex: number,
): PathCommand[] {
  const anchors = extractAnchors(path);
  if (anchorIndex < 0 || anchorIndex >= anchors.length) {
    return path.slice();
  }

  // サブパス境界の特定
  let subStart = anchorIndex;
  while (subStart > 0 && !anchors[subStart].subpathStart) subStart--;
  let subEnd = anchorIndex + 1;
  while (subEnd < anchors.length && !anchors[subEnd].subpathStart) subEnd++;
  const subCount = subEnd - subStart;

  // アンカーが 2 以下になる削除は拒否
  if (subCount <= 2) return path.slice();

  const anchor = anchors[anchorIndex];
  const result: PathCommand[] = [];

  if (anchor.subpathStart) {
    // M アンカーの削除: 次のアンカーを新しい M にする
    const next = anchors[anchorIndex + 1];
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
    const hasNext = (anchorIndex + 1) < subEnd;
    const nextCmdIndex = hasNext ? anchors[anchorIndex + 1].cmdIndex : -1;
    const nextAnchor = hasNext ? anchors[anchorIndex + 1] : null;

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

