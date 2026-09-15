/**
 * 日期字段显示格式工具（字段「额外属性」`date-format` 的配套工具）。
 *
 * 格式串 token：`{YYYY}` 年 / `{MM}` 月 / `{DD}` 日 / `{hh}` 时 / `{mm}` 分 / `{ss}` 秒。
 * 例：`{YYYY}年{MM}月{DD} {hh}时{mm}分{ss}秒`。
 *
 * 仅作用于【填写回写】环节：宿主（消费页）在日期选择器 change 时把原生 ISO 值
 * （`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm[:ss]`）按字段的格式串套成中文串写进 data，
 * 票面直接显示该串；脱敏/采集/打印均不改此逻辑（按 data 原样）。无格式串时原样存储（向后兼容）。
 *
 * 格式串存在字段的「额外属性」里，键名 **`date-format`**——这是宿主词表：宿主
 * `useFcDesigner.resolveDateFormat` 读的正是标签属性 `date-format`（并兼容
 * `data-date-format` / `dateFormat`）。旧 schema 的 `actionParams.format` 在读入时
 * 由 `schema-v2-serialization.ts` 改键迁移过来。
 *
 * 渲染内核不认识这些 token——它们属于宿主的「外部输入组件」职责：字段的 `params` 会原样
 * 落成标签上的 HTML 属性（见 `src/utils/node-params.ts`），宿主从属性自取后调用本工具。
 */

export interface DateParts {
  Y: string;
  M: string;
  D: string;
  h: string;
  m: string;
  s: string;
}

const TOKEN_SOURCE = "YYYY|MM|DD|hh|mm|ss";

/** 解析原生 ISO 值（date / datetime-local）为六段；无法解析返回 null。 */
function parseIso(iso: string): DateParts | null {
  const m = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return null;
  return {
    Y: m[1],
    M: m[2],
    D: m[3],
    h: m[4] ?? "0",
    m: m[5] ?? "0",
    s: m[6] ?? "0",
  };
}

function pad(value: string, len: number): string {
  return value.padStart(len, "0");
}

/**
 * 把原生 ISO 值格式化为配置串。无 format / 无值 / 无法解析 → 原样返回（向后兼容）。
 * 注意：替换发生在 format 模板上，值取自解析后的 iso 六段。
 */
export function formatDateValue(iso: string, format?: string): string {
  if (!format || !iso) return iso;
  const parts = parseIso(iso);
  if (!parts) return iso;
  return format.replace(new RegExp(`\\{(${TOKEN_SOURCE})\\}`, "g"), (_match, token: string) => {
    switch (token) {
      case "YYYY":
        return pad(parts.Y, 4);
      case "MM":
        return pad(parts.M, 2);
      case "DD":
        return pad(parts.D, 2);
      case "hh":
        return pad(parts.h, 2);
      case "mm":
        return pad(parts.m, 2);
      case "ss":
        return pad(parts.s, 2);
      default:
        return "";
    }
  });
}

/**
 * 把已格式化的值按 format 还原为原生 ISO（date 或 datetime-local），
 * 供宿主回填到原生选择器（再次打开时定位到已填值）。解析不到完整年月日 → 返回 ""（无法回填）。
 */
export function parseDateValue(formatted: string, format?: string): string {
  if (!format || !formatted) return "";
  // 按 format 中 token 出现顺序收集需要的段（Y/M/D/h/m/s）
  const order: string[] = [];
  const re = new RegExp(`\\{(${TOKEN_SOURCE})\\}`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(format))) order.push(m[1][0]);
  // 从已格式化串抽取所有数字段（顺序与 token 一致）
  const digits = formatted.match(/\d+/g) ?? [];
  if (digits.length < 3) return "";
  const pick = (t: string): string => {
    const idx = order.indexOf(t);
    return idx >= 0 ? digits[idx] ?? "" : "";
  };
  const Y = pick("Y") || String(new Date().getFullYear());
  const M = pick("M") || "1";
  const D = pick("D") || "1";
  const h = pick("h") || "0";
  const mi = pick("m") || "0";
  const s = pick("s") || "0";
  const hasTime = order.includes("h") || order.includes("m") || order.includes("s");
  if (hasTime) return `${Y}-${pad(M, 2)}-${pad(D, 2)}T${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}`;
  return `${Y}-${pad(M, 2)}-${pad(D, 2)}`;
}

/** 格式串是否含时间 token（决定宿主用 datetime-local 还是 date 选择器）。
 *  注意无 `i` 标志：分钟是小写 `{mm}`、月份是大写 `{MM}`，不可混。 */
export function formatHasTime(format?: string): boolean {
  return !!format && /(hh|mm|ss)/.test(format);
}
