"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Search as SearchIcon,
} from "lucide-react";
import {
  useDeferredValue,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: keyof T & string;
  header: string;
  cell?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "left" | "right";
  /** CSS width (e.g. "160px", "20%") — enables `table-layout: fixed` */
  width?: string;
  /** Prevent text wrapping in header + cells for this column. */
  nowrap?: boolean;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  searchable?: boolean;
  searchPlaceholder?: string;
  // WHY: caller controls how a row matches; we don't assume JSON-stringify safety.
  searchAccessor?: (row: T) => string;
  emptyState?: ReactNode;
  className?: string;
  rowKey?: (row: T, index: number) => string;
};

type SortState<T> = { key: keyof T & string; dir: "asc" | "desc" } | null;

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Generic controlled table — search, sortable columns, sticky header,
 * empty-state fallback. Pagination is intentionally out of scope.
 */
export function DataTable<T>({
  columns,
  rows,
  searchable = false,
  searchPlaceholder = "Search…",
  searchAccessor,
  emptyState,
  className,
  rowKey,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [sort, setSort] = useState<SortState<T>>(null);
  // WHY: when any column declares a width we switch to fixed-layout so the
  // browser respects it; otherwise auto-layout stretches columns to fit.
  const hasExplicitWidths = useMemo(
    () => columns.some((c) => c.width !== undefined),
    [columns],
  );

  const filtered = useMemo(() => {
    if (!searchable || !deferred.trim()) return rows;
    const q = deferred.trim().toLowerCase();
    const accessor =
      searchAccessor ??
      ((row: T) =>
        columns
          .map((c) => {
            const v = (row as Record<string, unknown>)[c.key];
            return v == null ? "" : String(v);
          })
          .join(" "));
    return rows.filter((r) => accessor(r).toLowerCase().includes(q));
  }, [rows, deferred, searchable, searchAccessor, columns]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sort.key];
      const bv = (b as Record<string, unknown>)[sort.key];
      const cmp = compare(av, bv);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sort]);

  function toggleSort(key: keyof T & string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {searchable ? (
        <div className="relative max-w-sm">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
            aria-label="Filter rows"
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* WHY: outer wrapper handles horizontal overflow so the table never
            bursts its container on narrow viewports (the stacked risk columns
            make it wide). Vertical scroll kicks in after the max-height. */}
        <div className="max-h-[70vh] overflow-auto">
          <table
            className={cn(
              "w-full border-collapse text-body",
              hasExplicitWidths && "table-fixed",
            )}
          >
            <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur">
              <tr>
                {columns.map((col) => {
                  const isSorted = sort?.key === col.key;
                  const dir = isSorted ? sort?.dir : undefined;
                  const alignRight = col.align === "right";
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      style={col.width ? { width: col.width } : undefined}
                      aria-sort={
                        isSorted
                          ? dir === "asc"
                            ? "ascending"
                            : "descending"
                          : col.sortable
                            ? "none"
                            : undefined
                      }
                      className={cn(
                        "border-b border-border px-4 py-2.5 text-[11px] font-medium text-muted-foreground",
                        alignRight ? "text-right" : "text-left",
                        col.nowrap && "whitespace-nowrap",
                      )}
                    >
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                            alignRight && "flex-row-reverse",
                          )}
                        >
                          <span>{col.header}</span>
                          {isSorted ? (
                            dir === "asc" ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3" aria-hidden />
                            )
                          ) : (
                            <ArrowUpDown
                              className="size-3 opacity-40"
                              aria-hidden
                            />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    {emptyState ?? "No results."}
                  </td>
                </tr>
              ) : (
                sorted.map((row, i) => (
                  <tr
                    key={rowKey ? rowKey(row, i) : i}
                    className="border-b border-border/60 transition-colors duration-150 last:border-b-0 hover:bg-muted/40"
                  >
                    {columns.map((col) => {
                      const alignRight = col.align === "right";
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            "px-4 py-3 align-middle",
                            alignRight ? "text-right" : "text-left",
                            col.nowrap && "whitespace-nowrap",
                          )}
                        >
                          {col.cell
                            ? col.cell(row)
                            : ((row as Record<string, unknown>)[
                                col.key
                              ] as ReactNode) ?? (
                                <span className="text-muted-foreground">
                                  —
                                </span>
                              )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
