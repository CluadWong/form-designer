import { describe, expect, it } from "vitest";
import { paginatePage, type PhysicalPage } from "@/engine-v2/pagination";
import type { GridNodeV2, PageSchemaV2 } from "@/types";

/** 造一个 rows 行的网格节点。 */
function makeGrid(id: string, rowCount: number, border: GridNodeV2["border"]): GridNodeV2 {
  return {
    id,
    type: "grid",
    border,
    rows: Array.from({ length: rowCount }, (_, i) => ({
      id: `${id}-r${i}`,
      type: "grid-row" as const,
      height: 1,
      cells: [
        {
          id: `${id}-r${i}-c0`,
          type: "grid-cell" as const,
          width: "1fr",
          children: [],
        },
      ],
    })),
    columns: ["1fr"],
  };
}

/** 每物理页的节点 id 摘要，便于断言。 */
function pageOutline(pages: PhysicalPage[]): string[][] {
  return pages
    .filter((p) => p.children.length > 0)
    .map((p) =>
      p.children.map((c) => {
        const n = c.node as GridNodeV2;
        return n.type === "grid" ? `${n.id}[${n.rows.length}]` : n.type;
      }),
    );
}

describe("短网格追加到满页 → 不被拆碎", () => {
  it("满页(272mm) + 3 行网格(24mm)：整格应落到下一页，而非首行留页尾、余行再翻页", () => {
    // A4 纵向 297mm，上下边距 12mm → 正文可用高 273mm
    const page: PageSchemaV2 = {
      id: "p1",
      type: "page",
      mode: "fixed",
      margin: { top: 12, right: 12, bottom: 12, left: 12 },
      children: [
        // 34 行 × 8mm = 272mm，恰好塞满第 1 页（剩 1mm）
        makeGrid("fill", 34, "none"),
        // 追加的 3 行网格，整格仅 24mm+边框 → 能整页放下
        makeGrid("appended", 3, "all"),
      ],
    };
    const result = paginatePage(page, {
      baseRowHeight: 8,
      bodyHeightMm: 273,
      contentWidthMm: 186,
    });
    const outline = pageOutline(result.pages);

    // 期望：第 2 页整格承载 3 行（不被切碎、不产生第 3 页）
    expect(outline).toHaveLength(2);
    expect(outline[0]).toEqual(["fill[34]"]);
    expect(outline[1]).toEqual(["appended[3]"]);
    expect(result.warnings).toHaveLength(0);
  });
});
