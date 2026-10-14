// システムフォントのカタログ (family → 利用可能な style 一覧) と style 文字列の解釈。
//
// DOM / fabric / Local Font Access API すべてに不知な pure module。列挙そのもの
// (window.queryLocalFonts の呼び出し) は presenter/font-list-loader.ts が担い、
// ここは「取得済みの生データを解釈して保持・問い合わせる」だけ。
//
// 旧 presenter/font-enumeration.ts は「列挙 + カタログ保持 + select への書き込み」の
// 3 責務が同居し、module-level で getElementById と populateFontList() を実行して
// いた。その pure な部分をここへ抽出したもの。

export type StyleInfo = {
  readonly label: string;
  readonly weight: number;
  readonly italic: boolean;
};

/** style 名が未知 / カタログが空のときに使う既定スタイル。 */
export const DEFAULT_STYLE: StyleInfo = Object.freeze({
  label: 'Regular',
  weight: 400,
  italic: false,
});

const WEIGHT_MAP: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  '': 400,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

/** "Bold Italic" のような style 名を weight + italic に正規化する。 */
export function parseStyle(s: string): StyleInfo {
  const lower = s.toLowerCase();
  const italic = /italic|oblique/.test(lower);
  const key = lower.replace(/italic|oblique/g, '').replace(/\s+/g, '');
  const weight = WEIGHT_MAP[key] ?? 400;
  return { label: s || DEFAULT_STYLE.label, weight, italic };
}

/** style select の option value 表現 (`"700|italic"`)。 */
export function styleValue(weight: number, italic: boolean): string {
  return `${weight}|${italic ? 'italic' : 'normal'}`;
}

/** 列挙元の生データ。Local Font Access API の FontData のうち必要な分だけを要求する
 *  (= core が FontData 型 = Web API に依存しないため)。 */
export interface FontEntry {
  readonly family: string;
  readonly style: string;
}

/**
 * family → style 一覧のカタログ。列挙結果を保持する stateful な器なので class + DI。
 *
 * 空の状態 (= 列挙前 / 列挙失敗) でも stylesOf は [DEFAULT_STYLE] を返すので、
 * 呼び側にフォールバック分岐は要らない。
 */
export class FontCatalog {
  private readonly byFamily = new Map<string, StyleInfo[]>();

  /** 列挙結果で中身を入れ替える。同一 (weight, italic) は 1 つに畳み、
   *  weight 昇順 → roman 優先でソートする。 */
  replaceAll(entries: ReadonlyArray<FontEntry>): void {
    this.byFamily.clear();
    for (const e of entries) {
      const info = parseStyle(e.style);
      let arr = this.byFamily.get(e.family);
      if (!arr) {
        arr = [];
        this.byFamily.set(e.family, arr);
      }
      if (!arr.some((x) => x.weight === info.weight && x.italic === info.italic)) {
        arr.push(info);
      }
    }
    for (const arr of this.byFamily.values()) {
      arr.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));
    }
  }

  isEmpty(): boolean {
    return this.byFamily.size === 0;
  }

  /** family 名の一覧 (日本語ロケールで昇順)。 */
  families(): string[] {
    return Array.from(this.byFamily.keys()).sort((a, b) => a.localeCompare(b, 'ja'));
  }

  /** family の style 一覧。未知 family / 空カタログなら [DEFAULT_STYLE]。 */
  stylesOf(family: string): ReadonlyArray<StyleInfo> {
    const styles = this.byFamily.get(family);
    return styles && styles.length > 0 ? styles : [DEFAULT_STYLE];
  }
}
