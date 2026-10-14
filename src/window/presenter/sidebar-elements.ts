// querySidebarElements: サイドバー配下の DOM 要素を 1 回だけ引いて束ねる factory。
//
// `as HTMLInputElement` の裸キャストだと ID を 1 つ変えても null が黙って通り、
// 実行時に初めて壊れる。ここで全要素を fail-fast 検証し、mount 時点で落とす
// (drawing-screen が `#drawing-canvas-container not found` 等で throw するのと同じ流儀)。
//
// 検索 root は screen root を受け取る (document 全体ではない)。将来別 screen が
// 独自サイドバーを持っても ID 解決が混ざらないようにするため。

import type {
  SidebarElements,
  FontSectionElements,
  TransformSectionElements,
  SnapSectionElements,
  ActionsSectionElements,
  ExportSectionElements,
} from './sidebar-elements-interface';

function req<T extends HTMLElement>(root: ParentNode, id: string): T {
  const el = root.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`querySidebarElements: #${id} not found`);
  return el;
}

export function querySidebarElements(root: ParentNode): SidebarElements {
  const font: FontSectionElements = {
    section: req(root, 'drawing-section-font'),
    family: req<HTMLSelectElement>(root, 'drawing-font-family'),
    style: req<HTMLSelectElement>(root, 'drawing-font-style'),
    size: req<HTMLInputElement>(root, 'drawing-font-size'),
    color: req<HTMLInputElement>(root, 'drawing-font-color'),
  };
  const transform: TransformSectionElements = {
    section: req(root, 'drawing-section-transform'),
    rotation: req<HTMLInputElement>(root, 'drawing-rotation'),
    apply: req<HTMLButtonElement>(root, 'drawing-btn-apply-rotation'),
  };
  const snap: SnapSectionElements = {
    section: req(root, 'drawing-section-snap'),
    enabled: req<HTMLInputElement>(root, 'drawing-snap-enabled'),
    pitch: req<HTMLInputElement>(root, 'drawing-snap-pitch'),
    threshold: req<HTMLInputElement>(root, 'drawing-snap-threshold'),
  };
  const actions: ActionsSectionElements = {
    section: req(root, 'drawing-section-actions'),
    selectAll: req<HTMLButtonElement>(root, 'drawing-btn-select-all'),
    clear: req<HTMLButtonElement>(root, 'drawing-btn-clear'),
    outline: req<HTMLButtonElement>(root, 'drawing-btn-outline'),
  };
  const exportSection: ExportSectionElements = {
    section: req(root, 'drawing-section-export'),
    png: req<HTMLButtonElement>(root, 'drawing-btn-export'),
  };

  return { font, transform, snap, actions, export: exportSection };
}
