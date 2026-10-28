import type {
  EdgeInsetsV2,
  FieldPNodeV2,
  FormNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  GridRowV2,
  PageSchemaV2,
  PaperConfigV2,
  TextNodeV2,
} from "@/types";

/**
 * 分页引擎演示 Schema：标题 + 一个 50 行 Grid。
 *
 * 目的：用「一个超高 Grid」直观验证分页 —— 50 行（每行 8mm）× 8mm 基准行高 = 400mm，
 * 远超 A4 纵向正文可用高（297 − 上下边距 10×2 = 277mm），必然被切成多张物理页。
 *
 * 构建全程使用设计器原语手搓（不读 JSON），结构如下：
 * - 一个标题 `text` 节点（第一行）
 * - 一个 50 行 `grid`（border=all，3 列），每格一个字段 P，字段 key 形如 `c{列}_{行}`
 *
 * 该 Schema 仅被单测复用（engine-v2/pagination.test.ts、GridFormRenderer.pagination.test.ts、
 * FormDesigner.pagination.test.ts 等），作为「超高 Schema」的分页测试夹具；预览页下拉已于廿二续移除。
 */

const BASE_ROW_HEIGHT = 8;
const ROW_COUNT = 50;
const MARGIN: EdgeInsetsV2 = { top: 10, right: 10, bottom: 10, left: 10 };
const PAPER: PaperConfigV2 = { size: "A4" };

function fieldP(id: string, field: string, label?: string): FieldPNodeV2 {
  return {
    id,
    type: "p",
    mode: "field",
    field,
    ...(label ? { prefix: label } : {}),
  };
}

function textNode(id: string, text: string): TextNodeV2 {
  return { id, type: "text", text };
}

function cell(id: string, children: FormNodeV2[]): GridCellV2 {
  return { id, type: "grid-cell", children };
}

function row(id: string, height: number, cells: GridCellV2[]): GridRowV2 {
  return { id, type: "grid-row", height, cells };
}

export function makeFiftyRowGridSchema(): FormSchemaV2 {
  const gridId = "big-grid";
  const gridRows: GridRowV2[] = [];
  for (let r = 1; r <= ROW_COUNT; r++) {
    const cells: GridCellV2[] = [
      cell(`c1_${r}`, [textNode(`t1_${r}`, `第 ${r} 行 / 列1`)]),
      cell(`c2_${r}`, [fieldP(`p2_${r}`, `col2_${r}`, "列2:")]),
      cell(`c3_${r}`, [fieldP(`p3_${r}`, `col3_${r}`, "列3:")]),
    ];
    gridRows.push(row(`r_${r}`, 1, cells));
  }

  const bigGrid: GridNodeV2 = {
    id: gridId,
    type: "grid",
    border: "all",
    rows: gridRows,
    columns: ["1fr", "1fr", "1fr"],
    cellPadding: 1,
  };

  const title: TextNodeV2 = textNode("demo-title", "测试夹具：50 行 Grid（超高分页）");

  const page: PageSchemaV2 = {
    id: "demo-page",
    type: "page",
    mode: "fixed",
    margin: MARGIN,
    children: [title, bigGrid],
  };

  return {
    version: 2,
    paper: PAPER,
    baseRowHeight: BASE_ROW_HEIGHT,
    pages: [page],
  };
}
