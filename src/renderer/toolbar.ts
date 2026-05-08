// ツールバー (モード切替ボタン群) を tools 配列から動的生成する。
//
// 各 Tool が descriptor (id / label / iconSvg) を自己完結で持っているので、
// ここは「受け取った文字列を innerHTML に流す pure sink」 として動く。
// renderer 側で icon registry のような中間層は持たない (1 アイコン 1 箇所主義)。
//
// 戻り値の <button> マップは app.ts の setMode が is-active class 切替で参照する。
//
// 構造不変条件 (非空フィールド / id 衝突無し) は起動時に fail-fast で弾く。
// 開発時にツールを足し間違えれば即座に例外で気付ける形にしている。

import type { Tool } from '../tools/tool-interface';

function assertValidDescriptors(tools: ReadonlyArray<Tool>): void {
  const seen = new Set<string>();
  for (const t of tools) {
    const d = t.descriptor;
    if (!d.id || !d.label || !d.iconSvg) {
      throw new Error(
        `tool descriptor has empty field(s): ${JSON.stringify(d)}`,
      );
    }
    if (seen.has(d.id)) {
      throw new Error(`duplicate tool descriptor id: ${d.id}`);
    }
    seen.add(d.id);
  }
}

export function buildToolbar(
  tools: ReadonlyArray<Tool>,
  container: HTMLElement,
  onSelect: (id: string) => void,
): Record<string, HTMLButtonElement> {
  assertValidDescriptors(tools);

  container.innerHTML = '';
  const map: Record<string, HTMLButtonElement> = {};

  for (const t of tools) {
    const d = t.descriptor;
    const btn = document.createElement('button');
    btn.id = `btn-mode-${d.id}`;
    btn.className = 'mode-btn';
    btn.title = d.label;
    btn.innerHTML = d.iconSvg;
    btn.addEventListener('click', () => onSelect(d.id));
    container.appendChild(btn);
    map[d.id] = btn;
  }

  return map;
}
