// サイドバー (#drawing-sidebar) の DOM 要素束の型。
//
// 目的: 同じ要素を SidebarController / SidebarPresenter / font-current が
// それぞれ独立に getElementById していた重複を 1 か所に集約すること。取得は
// sidebar-elements.ts の querySidebarElements が mount 時に 1 回だけ行い、
// 以降は consumer に DI する (module-level の getElementById 副作用を持たない)。
//
// section 別のネストにしてあるのは、将来「選択 / mode に応じて section ごと
// 出し分ける」ときに section container (`.section`) が要るため。
//
// interface のみ (実装 = querySidebarElements は sidebar-elements.ts)。

export interface FontSectionElements {
  readonly section: HTMLElement;
  readonly family: HTMLSelectElement;
  readonly style: HTMLSelectElement;
  readonly size: HTMLInputElement;
  readonly color: HTMLInputElement;
}

export interface TransformSectionElements {
  readonly section: HTMLElement;
  readonly rotation: HTMLInputElement;
  readonly apply: HTMLButtonElement;
}

export interface SnapSectionElements {
  readonly section: HTMLElement;
  readonly enabled: HTMLInputElement;
  readonly pitch: HTMLInputElement;
  readonly threshold: HTMLInputElement;
}

export interface ActionsSectionElements {
  readonly section: HTMLElement;
  readonly selectAll: HTMLButtonElement;
  readonly clear: HTMLButtonElement;
  readonly outline: HTMLButtonElement;
}

export interface ExportSectionElements {
  readonly section: HTMLElement;
  readonly png: HTMLButtonElement;
}

export interface SidebarElements {
  readonly font: FontSectionElements;
  readonly transform: TransformSectionElements;
  readonly snap: SnapSectionElements;
  readonly actions: ActionsSectionElements;
  readonly export: ExportSectionElements;
}
