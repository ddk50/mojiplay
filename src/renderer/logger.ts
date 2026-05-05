// IPC → electron-log + DevTools console を束ねるロガー。
// renderer 内のすべてのファイルから参照可能 (module: "none" によりグローバル)。

const logger = {
  debug: (msg: string) => {
    console.debug(msg);
    void window.electronAPI?.log?.debug(msg);
  },
  info: (msg: string) => {
    console.info(msg);
    void window.electronAPI?.log?.info(msg);
  },
  warn: (msg: string) => {
    console.warn(msg);
    void window.electronAPI?.log?.warn(msg);
  },
  error: (msg: string, err?: unknown) => {
    const stack = err instanceof Error
      ? `\n${err.stack ?? err.message}`
      : (err != null ? `\n${String(err)}` : '');
    const full = msg + stack;
    console.error(full);
    void window.electronAPI?.log?.error(full);
  },
};
