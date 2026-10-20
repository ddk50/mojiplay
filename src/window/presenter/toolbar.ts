// Toolbar (= 画面下中央のフローティングツールバー) の内→外。
//
// 守備範囲は **ツール (= mode) 選択ボタンの生成だけ**。右パネルのプロパティ
// コントロールは Sidebar の担当 (presenter/sidebar.ts / controllers/sidebar.ts) で、
// ここには置かない。
//
// buildModeButtons は mode 切替ボタン群を tools 配列から動的生成する。各 Tool が
// descriptor (id / label / iconSvg) を自己完結で持つので「受け取った文字列を
// innerHTML に流す pure sink」として動く。icon registry のような中間層は持たない
// (1 アイコン 1 箇所主義)。構造不変条件 (非空フィールド / id 衝突無し) は起動時に
// fail-fast で弾く。
//
// 保持する state が無いので class ではなく free function (CLAUDE.md 命名規約)。

import type { Tool } from '../usecases/tools/tool-interface';

function assertValidDescriptors(tools: ReadonlyArray<Tool>): void {
  const seen = new Set<string>();
  for (const t of tools) {
    const d = t.descriptor;
    if (!d.id || !d.label || !d.iconSvg) {
      throw new Error(`tool descriptor has empty field(s): ${JSON.stringify(d)}`);
    }
    if (seen.has(d.id)) {
      throw new Error(`duplicate tool descriptor id: ${d.id}`);
    }
    seen.add(d.id);
  }
}

/** tools を iterate して mode button を container に生成し、mode id → button の
 *  マップを返す (is-active class 切替のため ToolbarController が保持する)。 */
export function buildModeButtons(
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
