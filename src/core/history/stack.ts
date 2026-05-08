// HistoryStack 実装: ring buffer + 論理 cursor。
//
// 設計の詳細は CLAUDE.md「HistoryStack のデータ構造: ring buffer + cursor」参照。
//
// state:
//   buf:     固定長の Command 配列 (length = max)
//   head:    logical index 0 が指す物理 index
//   size:    有効エントリ数 (cursor + redo 列を含む)
//   cursor:  最後に apply 済みの logical index (-1 = 何も無い)
//
// 物理 index = (head + logicalIndex) % max でアクセス。

import type { Command, HistoryStack } from './types';

export interface HistoryStackOptions {
  max?: number;  // 履歴上限 (default: 100)
}

export function createHistoryStack(opts: HistoryStackOptions = {}): HistoryStack {
  const max = opts.max ?? 100;
  if (max < 1) throw new Error(`HistoryStack max must be >= 1 (got ${max})`);

  const buf: (Command | undefined)[] = new Array(max);
  let head = 0;
  let size = 0;
  let cursor = -1;

  const at = (logical: number): Command => {
    return buf[(head + logical) % max] as Command;
  };

  return {
    push(cmd: Command): void {
      // redo 列を切り捨て (cursor より後ろは無効化)
      size = cursor + 1;

      if (size < max) {
        buf[(head + size) % max] = cmd;
        size++;
        cursor++;
      } else {
        // size === max: head を進めて古い側を上書き
        // logical 0 番目 (= 最古) を捨てて新エントリを末尾に追加
        // = head を 1 進めれば、これまでの buf[head] が「捨てられた最古」になり、
        //   その位置に新エントリを書き込むのと等価
        buf[head] = cmd;
        head = (head + 1) % max;
        // size は max 据え置き、cursor も max - 1 据え置き (entry が 1 個入れ替わっただけ)
      }
    },

    undo(): Command | null {
      if (cursor < 0) return null;
      const cmd = at(cursor);
      cursor--;
      return cmd;
    },

    redo(): Command | null {
      if (cursor + 1 >= size) return null;
      cursor++;
      return at(cursor);
    },

    canUndo(): boolean { return cursor >= 0; },
    canRedo(): boolean { return cursor + 1 < size; },

    clear(): void {
      buf.fill(undefined);
      head = 0;
      size = 0;
      cursor = -1;
    },

    linearize(): ReadonlyArray<Command> {
      const out: Command[] = new Array(size);
      for (let i = 0; i < size; i++) {
        out[i] = at(i);
      }
      return out;
    },
  };
}
