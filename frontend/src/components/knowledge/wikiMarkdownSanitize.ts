import type { Options as SanitizeOptions } from "rehype-sanitize";
import { defaultSchema } from "rehype-sanitize";

const TABLE_CELL_ATTRS = [
  "align",
  "colSpan",
  "colspan",
  "rowSpan",
  "rowspan",
  "width",
] as const;

/** 允许 OCR HTML table，同时挡住 script 等危险标签 */
export const wikiSanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "caption",
    "colgroup",
    "col",
  ],
  attributes: {
    ...defaultSchema.attributes,
    table: [...(defaultSchema.attributes?.table ?? []), "className", "class", "border", "width"],
    th: [...(defaultSchema.attributes?.th ?? []), ...TABLE_CELL_ATTRS],
    td: [...(defaultSchema.attributes?.td ?? []), ...TABLE_CELL_ATTRS],
    col: [...(defaultSchema.attributes?.col ?? []), "span", "width"],
  },
};
