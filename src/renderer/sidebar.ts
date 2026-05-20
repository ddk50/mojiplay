// Sidebar: 右サイドバーの可変幅 + 折りたたみ + 完全 hide を担う pure DOM helper。
//
// State / business を持たないため Controller 抽象は新設せず、camera 層 op
// (= switch-mode / zoom-canvas-by-wheel 等) と同類の renderer/ 配下 helper として配置。
//
// 責務:
// - left 端 drag handle (mousedown → mousemove で幅変更、min/max clamp)
// - header の toggle button click で is-collapsed (40px アイコンストリップ) トグル
// - Tab キーで is-hidden (幅 0、完全 hide) トグル。IText 編集中 / input focus 中は bypass
// - 幅 / collapsed / hidden を LocalStorage に独立保存・復元
//
// 戻り値は detach 関数。screen unmount / window unload で呼ぶ。

const LS_KEY_WIDTH = 'mojiplay.sidebar.width';
const LS_KEY_COLLAPSED = 'mojiplay.sidebar.collapsed';
const LS_KEY_HIDDEN = 'mojiplay.sidebar.hidden';

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;

function setWidthVar(width: number): void {
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
}

function restoreInitial(sidebar: HTMLElement): void {
  const raw = localStorage.getItem(LS_KEY_WIDTH);
  const parsed = raw === null ? NaN : parseInt(raw, 10);
  const width = Number.isFinite(parsed)
    ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed))
    : DEFAULT_WIDTH;
  setWidthVar(width);

  if (localStorage.getItem(LS_KEY_COLLAPSED) === '1') {
    sidebar.classList.add('is-collapsed');
  }
  if (localStorage.getItem(LS_KEY_HIDDEN) === '1') {
    sidebar.classList.add('is-hidden');
  }
}

export function attachSidebar(sidebarRoot: HTMLElement): () => void {
  const handle = sidebarRoot.querySelector<HTMLElement>('.sidebar-resize-handle');
  const toggle = sidebarRoot.querySelector<HTMLButtonElement>('.sidebar-toggle');
  if (!handle || !toggle) {
    throw new Error('attachSidebar: .sidebar-resize-handle and .sidebar-toggle required');
  }

  restoreInitial(sidebarRoot);

  // ── drag-to-resize ─────────────────────────────────────────────────
  // 右サイドバーは右側に貼り付いているので、ドラッグでサイドバー左端が
  // 左に動く = 幅が増える。pointer の clientX とウィンドウ右端の差分が幅。

  let dragging = false;

  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
    setWidthVar(next);
  };

  const onMouseUp = (): void => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('is-dragging');
    document.body.style.cursor = '';
    // 現在の幅 (CSS variable) を LocalStorage に保存
    const w = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'),
      10,
    );
    if (Number.isFinite(w)) localStorage.setItem(LS_KEY_WIDTH, String(w));
  };

  const onHandleMouseDown = (e: MouseEvent): void => {
    // 折りたたみ / hidden 中はドラッグ無効
    if (sidebarRoot.classList.contains('is-collapsed')) return;
    if (sidebarRoot.classList.contains('is-hidden')) return;
    e.preventDefault();
    dragging = true;
    handle.classList.add('is-dragging');
    document.body.style.cursor = 'ew-resize';
  };

  handle.addEventListener('mousedown', onHandleMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // ── collapse toggle ────────────────────────────────────────────────

  const onToggleClick = (): void => {
    const next = !sidebarRoot.classList.contains('is-collapsed');
    sidebarRoot.classList.toggle('is-collapsed', next);
    toggle.setAttribute('aria-expanded', String(!next));
    localStorage.setItem(LS_KEY_COLLAPSED, next ? '1' : '0');
  };

  toggle.addEventListener('click', onToggleClick);

  // ── Tab で完全 hide / 復帰 (Photoshop 慣習) ───────────────────────

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    // IText 編集中 / input or select focus 中は素通し (タブ移動を維持)
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (target.isContentEditable) return;
    }
    e.preventDefault();
    const next = !sidebarRoot.classList.contains('is-hidden');
    sidebarRoot.classList.toggle('is-hidden', next);
    localStorage.setItem(LS_KEY_HIDDEN, next ? '1' : '0');
  };

  document.addEventListener('keydown', onKeyDown);

  // ── detach ─────────────────────────────────────────────────────────

  return (): void => {
    handle.removeEventListener('mousedown', onHandleMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    toggle.removeEventListener('click', onToggleClick);
    document.removeEventListener('keydown', onKeyDown);
  };
}
