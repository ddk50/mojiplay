// 黒矢印 (SelectGroup) ツールの中核ロジック (純粋関数)。
//
// 「現在の選択を、同じ groupId を持つ全オブジェクトに展開する」計算を、
// fabric.Object に依存しない形で行う。Tool 側は host から ObjectHandle 列を
// 受け取って本関数に渡し、結果を host.setActiveSelection で反映するだけ。
//
// 戻り値の alreadyExpanded は「現在の選択が既に group 全体と一致しているか」。
// SelectGroupTool は selection:created/updated 内で呼ぶため、再展開時に
// setActiveSelection が再帰発火してループに入るのを防ぐ no-op 判定に使う。

export interface GroupExpansionResult<T> {
  readonly expanded: ReadonlyArray<T>;
  readonly alreadyExpanded: boolean;
}

export function computeGroupExpansion<T>(
  current: ReadonlyArray<T>,
  all:     ReadonlyArray<T>,
  getGroupId: (o: T) => string | undefined,
): GroupExpansionResult<T> {
  const gids = new Set<string>();
  for (const o of current) {
    const gid = getGroupId(o);
    if (gid !== undefined) gids.add(gid);
  }

  // groupId を持たないオブジェクト (例: 単独のアウトラインパスなど) のみ選択中なら
  // 展開対象が無いので no-op として扱う。
  if (gids.size === 0) {
    return { expanded: current, alreadyExpanded: true };
  }

  const expanded = all.filter(o => {
    const gid = getGroupId(o);
    return gid !== undefined && gids.has(gid);
  });

  // 既に完全展開済みなら setActiveSelection を呼ばないために alreadyExpanded = true。
  // 順序は問わず、要素集合の一致だけ判定する。
  const alreadyExpanded =
    current.length === expanded.length &&
    current.every(o => expanded.indexOf(o) >= 0);

  return { expanded, alreadyExpanded };
}
