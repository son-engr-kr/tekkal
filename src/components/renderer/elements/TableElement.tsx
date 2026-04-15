import type { TableElement as TableElementType, TableStyle } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { renderInline } from "@/utils/markdown";

interface Props {
  element: TableElementType;
}

/**
 * Detect the legacy object format (`columns: [{key,label}]`, `rows: [{key:value}]`)
 * that used to silently render as an empty table. Now reported as a visible
 * error so authors can't miss it. Only the canonical `string[]` / `string[][]`
 * format is supported.
 */
function detectTableFormatError(element: TableElementType): string | null {
  const cols = element.columns as unknown;
  const rows = element.rows as unknown;
  if (!Array.isArray(cols)) {
    return "table.columns must be a string[] (got " + typeof cols + ")";
  }
  if (cols.some((c) => typeof c !== "string")) {
    return "table.columns must be string[] — got object/other form. Legacy {key,label} objects are no longer supported; use plain strings.";
  }
  if (!Array.isArray(rows)) {
    return "table.rows must be string[][] (got " + typeof rows + ")";
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) {
      return `table.rows[${i}] must be a string[] — got object/other form. Legacy {key:value} row objects are no longer supported; use plain string arrays aligned with columns.`;
    }
    if (row.some((c) => typeof c !== "string")) {
      return `table.rows[${i}] must contain only strings`;
    }
  }
  return null;
}

export function TableElementRenderer({ element }: Props) {
  const style = useElementStyle<TableStyle>("table", element.style);

  const formatError = detectTableFormatError(element);
  if (formatError) {
    if (import.meta.env.DEV) {
      // Throwing in dev surfaces the stack trace and drives the AI fix loop.
      throw new Error(`[TableElement ${element.id}] ${formatError}`);
    }
    return (
      <div
        style={{
          width: element.size.w,
          height: element.size.h,
          backgroundColor: "#fef2f2",
          border: "1px solid #b91c1c",
          borderRadius: 4,
          padding: 8,
          color: "#991b1b",
          fontSize: 12,
          fontFamily: "monospace",
          overflow: "auto",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ Table format error</div>
        <div>{formatError}</div>
      </div>
    );
  }

  const fontSize = style.fontSize ?? 14;
  const color = style.color ?? "#1e293b";
  const headerBg = style.headerBackground ?? "#f1f5f9";
  const headerColor = style.headerColor ?? "#0f172a";
  const borderColor = style.borderColor ?? "#e2e8f0";
  const striped = style.striped ?? false;
  const borderRadius = style.borderRadius ?? 8;

  return (
    <div
      style={{
        width: element.size.w,
        height: element.size.h,
        overflow: "auto",
        borderRadius,
        border: `1px solid ${borderColor}`,
      }}
    >
      <table
        style={{
          width: "100%",
          height: "100%",
          borderCollapse: "collapse",
          fontSize,
          color,
        }}
      >
        <thead>
          <tr>
            {element.columns.map((col, i) => (
              <th
                key={i}
                style={{
                  backgroundColor: headerBg,
                  color: headerColor,
                  padding: "6px 10px",
                  borderBottom: `1px solid ${borderColor}`,
                  textAlign: "left",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {renderInline(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {element.rows.map((row, ri) => {
            const isLastRow = ri === element.rows.length - 1;
            return (
              <tr
                key={ri}
                style={{
                  backgroundColor:
                    striped && ri % 2 === 1 ? `${headerBg}80` : "transparent",
                }}
              >
                {element.columns.map((_, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "5px 10px",
                      borderBottom: isLastRow ? "none" : `1px solid ${borderColor}`,
                    }}
                  >
                    {renderInline(row[ci] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
