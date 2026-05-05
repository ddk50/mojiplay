// 簡易トースト通知。3 秒で自動消去。
// isError=true で赤背景 (CSS class "toast-error")。

function showToast(message: string, isError = false): void {
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
