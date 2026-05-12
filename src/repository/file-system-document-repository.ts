// FileSystemDocumentRepository: DocumentRepository の Electron / fs 実装。
//
// ファイル I/O / dialog / IPC / schema validation すべてここに閉じる。
// FileIOInteractor は本 class を constructor 経由で受け取り、I/O 詳細を不知のまま動作。
//
// schema validation (validateSnapshot) は stateless transform なので free function 据え置き。

import type { DocumentRepository } from './document-repository-interface';
import type {
  DocumentSnapshot, LoadResult, SaveResult, LoadError,
} from '../core/document/snapshot';

export class FileSystemDocumentRepository implements DocumentRepository {
  async save(snapshot: DocumentSnapshot, currentPath: string | null): Promise<SaveResult> {
    if (!window.electronAPI?.saveMply) {
      return { ok: false, canceled: false, error: { message: 'electronAPI.saveMply が未配線' } };
    }
    const json = JSON.stringify(snapshot);
    const r = await window.electronAPI.saveMply(json, currentPath);
    if (r.success) return { ok: true, filePath: r.filePath };
    if (r.reason === 'canceled') return { ok: false, canceled: true };
    return { ok: false, canceled: false, error: { message: r.reason } };
  }

  async load(): Promise<LoadResult> {
    if (!window.electronAPI?.openMply) {
      return { ok: false, canceled: false, error: { kind: 'io', message: 'electronAPI.openMply が未配線' } };
    }
    const r = await window.electronAPI.openMply();
    if (!r.ok) {
      if (r.reason === 'canceled') return { ok: false, canceled: true };
      return { ok: false, canceled: false, error: { kind: 'io', message: r.reason } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.content);
    } catch (err) {
      return { ok: false, canceled: false, error: { kind: 'invalid-json', message: (err as Error).message } };
    }
    const validated = validateSnapshot(parsed);
    if (validated.kind === 'err') {
      return { ok: false, canceled: false, error: validated.error };
    }
    return { ok: true, snapshot: validated.snapshot, filePath: r.filePath };
  }
}

function validateSnapshot(raw: unknown):
  | { kind: 'ok';  snapshot: DocumentSnapshot }
  | { kind: 'err'; error: LoadError } {
  if (!raw || typeof raw !== 'object') {
    return { kind: 'err', error: { kind: 'format-mismatch', got: raw } };
  }
  const r = raw as { format?: unknown; version?: unknown; canvas?: unknown };
  if (r.format !== 'mojiplay') {
    return { kind: 'err', error: { kind: 'format-mismatch', got: r.format } };
  }
  if (r.version !== 1) {
    return { kind: 'err', error: { kind: 'unsupported-version', version: r.version } };
  }
  return { kind: 'ok', snapshot: { format: 'mojiplay', version: 1, canvas: r.canvas } };
}
