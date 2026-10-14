// サイドバーの font-family / font-style select を FontCatalog の内容で埋める
// free function 群 (stateless)。
//
// SidebarPresenter (列挙完了時 / 選択同期時) と SidebarController (family の
// change 時) の **両方** から呼ばれる。Controller が Presenter を蹴らずに
// 済ませるため、Presenter のメソッドではなく free function に置いてある。
//
// 順序の注意: family change 時は「style 一覧を作り直す → その値を読む」の順が
// 必須 (先に読むと前 family の style が残る)。Controller が 1 関数内で
// populateStyleList → currentFontStyle の順に呼ぶことで保証している。

import type { FontCatalog } from '../core/font-catalog';
import { styleValue } from '../core/font-catalog';
import type { SidebarElements } from './sidebar-elements-interface';

/** style select を family の利用可能スタイルで埋め直す。
 *  選択値はできるだけ維持し、無ければ Regular → 先頭の順にフォールバック。 */
export function populateStyleList(
  els: SidebarElements,
  catalog: FontCatalog,
  family: string,
): void {
  const sel = els.font.style;
  const previous = sel.value;
  const list = catalog.stylesOf(family);

  sel.innerHTML = '';
  for (const s of list) {
    const opt = document.createElement('option');
    opt.value = styleValue(s.weight, s.italic);
    opt.textContent = s.label;
    sel.appendChild(opt);
  }

  const values = list.map((s) => styleValue(s.weight, s.italic));
  if (values.includes(previous)) {
    sel.value = previous;
  } else {
    const regular = styleValue(400, false);
    sel.value = values.includes(regular) ? regular : values[0];
  }
}

/** family select を catalog の全 family で埋め直し、style 一覧も追従させる。
 *  列挙が成功した後に 1 回呼ぶ想定 (空カタログでは何もしない)。 */
export function refreshFontLists(els: SidebarElements, catalog: FontCatalog): void {
  if (catalog.isEmpty()) return;

  const sel = els.font.family;
  const families = catalog.families();
  const previous = sel.value;

  sel.innerHTML = '';
  for (const family of families) {
    const opt = document.createElement('option');
    opt.value = family;
    opt.textContent = family;
    sel.appendChild(opt);
  }
  sel.value = families.includes(previous) ? previous : families[0];

  populateStyleList(els, catalog, sel.value);
}
