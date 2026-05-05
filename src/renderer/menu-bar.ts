// HTML ベースのカスタムメニューバー (Claude Desktop 風)
//
// ネイティブ Electron メニューの代わりに #menu-bar を開閉する UI ロジック。
// 実際のアクション処理は呼び出し側 (app.ts の handleMenuAction) に任せる。

export function initMenuBar(handleAction: (action: string) => void): void {
  const menuItems = document.querySelectorAll('#menu-bar .menu-item');

  function closeAll(): void {
    menuItems.forEach(mi => mi.classList.remove('is-open'));
  }

  menuItems.forEach(item => {
    const label = item.querySelector('.menu-label');
    if (!label) return;

    label.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = item.classList.contains('is-open');
      closeAll();
      if (!wasOpen) item.classList.add('is-open');
    });

    // ホバーで切り替え (他メニューが開いている時)
    label.addEventListener('mouseenter', () => {
      const anyOpen = document.querySelector('#menu-bar .menu-item.is-open');
      if (anyOpen && anyOpen !== item) {
        closeAll();
        item.classList.add('is-open');
      }
    });
  });

  // 外クリックで閉じる
  document.addEventListener('click', closeAll);

  // アクション実行 (data-action 属性の文字列を呼び出し側にディスパッチ)
  document.querySelectorAll('#menu-bar .menu-dropdown button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action;
      closeAll();
      handleAction(action || '');
    });
  });
}
