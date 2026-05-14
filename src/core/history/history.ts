// History 実装。
//
// 抽象としては「コマンド履歴 + 編集 cursor」(Stack ではない: redo 列を持つ)。
// 内部ストレージは ring buffer (循環バッファ + 論理 cursor) で、上限超過時の
// 旧履歴破棄を O(1) でこなす。詳細は CLAUDE.md「History のデータ構造:
// ring buffer + cursor」参照。
//
// state:
//   buf:     固定長の Command 配列 (length = max)
//   head:    logical index 0 が指す物理 index
//   size:    有効エントリ数 (cursor + redo 列を含む)
//   cursor:  最後に apply 済みの logical index (-1 = 何も無い)
//
// 物理 index = (head + logicalIndex) % max でアクセス。

import type { Command, History as HistoryContract } from './types';

export interface HistoryOptions {
  max?: number; // 履歴上限 (default: 100)
}

export class History implements HistoryContract {
  private readonly max: number;
  private readonly buf: (Command | undefined)[];
  private head = 0;
  private size = 0;
  private cursor = -1;

  constructor(opts: HistoryOptions = {}) {
    const max = opts.max ?? 100;
    if (max < 1) throw new Error(`History max must be >= 1 (got ${max})`);
    this.max = max;
    this.buf = new Array(max);
  }

  private at(logical: number): Command {
    return this.buf[(this.head + logical) % this.max] as Command;
  }

  push(cmd: Command): void {
    // redo 列を切り捨て (cursor より後ろは無効化)
    this.size = this.cursor + 1;

    if (this.size < this.max) {
      this.buf[(this.head + this.size) % this.max] = cmd;
      this.size++;
      this.cursor++;
    } else {
      // size === max: head を進めて古い側を上書き
      // logical 0 番目 (= 最古) を捨てて新エントリを末尾に追加
      // = head を 1 進めれば、これまでの buf[head] が「捨てられた最古」になり、
      //   その位置に新エントリを書き込むのと等価
      this.buf[this.head] = cmd;
      this.head = (this.head + 1) % this.max;
      // size は max 据え置き、cursor も max - 1 据え置き (entry が 1 個入れ替わっただけ)
    }
  }

  undo(): Command | null {
    if (this.cursor < 0) return null;
    const cmd = this.at(this.cursor);
    this.cursor--;
    return cmd;
  }

  redo(): Command | null {
    if (this.cursor + 1 >= this.size) return null;
    this.cursor++;
    return this.at(this.cursor);
  }

  canUndo(): boolean {
    return this.cursor >= 0;
  }
  canRedo(): boolean {
    return this.cursor + 1 < this.size;
  }

  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.size = 0;
    this.cursor = -1;
  }

  linearize(): ReadonlyArray<Command> {
    const out: Command[] = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      out[i] = this.at(i);
    }
    return out;
  }
}
