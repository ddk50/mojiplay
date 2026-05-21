// DocumentRepository: ドキュメントの永続化境界 (Clean Architecture の Repository)。
//
// Hexagonal 視点で「Driven 側の port + adapter を 1 ヶ所に寄せた」 sibling 階層。
// usecases/ や renderer/ の中に置かず、top-level src/repository/ に独立して配置する:
//   - usecases/ の中に置くと「Repository は Use Case の一部」と読める階層になり、概念の sibling 性が崩れる
//   - renderer/ (= Presenter) の中に置くと Gateway を Presenter 階層に混ぜることになる
//
// 同 dir 内に interface と concrete impl を併置 (file-system-document.ts)。
// 命名で interface (= port) と adapter を区別。

import type { DocumentSnapshot, LoadResult, SaveResult } from '../core/document/snapshot';

export interface DocumentRepository {
  /**
   * 保存。currentPath が null なら dialog で新規パスを取得 (= 別名保存 / 初回保存)、
   * 非 null なら同パスへ atomic に上書き保存。
   */
  save(snapshot: DocumentSnapshot, currentPath: string | null): Promise<SaveResult>;

  /** ユーザに dialog でファイルを選ばせて開く。 */
  load(): Promise<LoadResult>;
}
