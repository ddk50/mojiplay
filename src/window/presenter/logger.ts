// IPC → electron-log + DevTools console を束ねるロガー。

/**
 * fabric.Object を log に埋めるときの formatter。
 * 例: "text:01HK7A12" / "path:01HK7B34" / "<noid:i-text>" / "<null>"
 *
 * 規律: log 出力で fabric.Object を識別したい場合は必ずこの関数を経由する
 * (生 ULID を log に出さない)。
 */
export function fmtObj(obj: fabric.Object | null | undefined): string {
  if (!obj) return '<null>';
  const d = obj.data;
  if (d?.type && d?.objectId) {
    return `${d.type}:${String(d.objectId).slice(0, 8)}`;
  }
  return `<noid:${obj.type ?? '?'}>`;
}

export const logger = {
  debug: (msg: string) => {
    console.debug(msg);
    void window.electronIPC?.log?.debug(msg);
  },
  info: (msg: string) => {
    console.info(msg);
    void window.electronIPC?.log?.info(msg);
  },
  warn: (msg: string) => {
    console.warn(msg);
    void window.electronIPC?.log?.warn(msg);
  },
  error: (msg: string, err?: unknown) => {
    const stack =
      err instanceof Error
        ? `\n${err.stack ?? err.message}`
        : err != null
          ? `\n${String(err)}`
          : '';
    const full = msg + stack;
    console.error(full);
    void window.electronIPC?.log?.error(full);
  },
};
