// commitIText / duplicateSelection が共有する groupId 生成ヘルパ。
//
// groupId は「同じ IText から生成された char の集合」を表す。後続で
// data.groupId フィルタにより word を再構築する。

export function generateGroupId(): string {
  return `g-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
