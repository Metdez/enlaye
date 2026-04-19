"use client";

// Projects table for a portfolio — rendered via DataTable.
// WHY: client component. `DataTable` owns its own search/sort state and column
// `cell` renderers are functions — they can't cross the RSC boundary from a
// server parent. Marking the whole table client-side keeps column defs local.
// Column styling highlights problem dimensions with tone via
// class (amber delays, rose overruns, orange safety, violet disputes) so the
// table reads as a heat map without a second chart. Inline AnomalyBadges in
// the Flags column surface why each row is interesting at a glance.

import type { ReactElement } from "react";
import { Table2 } from "lucide-react";

import {
  AnomalyBadge,
  type AnomalyCategory,
} from "@/components/data/anomaly-badge";
import { DataTable, type Column } from "@/components/data/data-table";
import { StatusDot, type StatusTone } from "@/components/data/status-dot";
import { TabularNumber } from "@/components/data/tabular-number";
import { EmptyState } from "@/components/state/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectRow } from "@/lib/types";

// WHY: the ML service ships snake_case flag strings (`cost_overrun_high`, etc.).
// The new AnomalyBadge takes `category` from a closed union; this is the
// canonical mapping. Unknown strings fall through to `null` and are skipped
// so a future flag doesn't render as a mystery badge.
const FLAG_TO_CATEGORY: Record<string, AnomalyCategory> = {
  cost_overrun_high: "cost_overrun",
  delay_days_high: "schedule_delay",
  safety_incidents_high: "safety",
  payment_disputes_high: "disputes",
};

function flagsToBadges(flags: string[] | null | undefined): ReactElement {
  const list = flags ?? [];
  if (list.length === 0) {
    return <span className="text-meta">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((f) => {
        const cat = FLAG_TO_CATEGORY[f];
        if (!cat) return null;
        return <AnomalyBadge key={f} category={cat} />;
      })}
    </div>
  );
}

function statusTone(value: ProjectRow["final_status"]): StatusTone {
  if (value === "Completed") return "success";
  if (value === "In Progress") return "info";
  return "neutral";
}

// WHY: compact "MMM yy" for table density; full date is an unnecessary axis
// in a project list where relative ordering matters more than absolute day.
const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
});

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return SHORT_DATE.format(new Date(iso));
  } catch {
    return "—";
  }
}

const columns: Column<ProjectRow>[] = [
  {
    key: "project_id_external",
    header: "ID",
    width: "84px",
    nowrap: true,
    sortable: true,
    cell: (row) => (
      <span className="font-mono text-meta text-muted-foreground">
        {row.project_id_external ?? "—"}
      </span>
    ),
  },
  {
    key: "project_name",
    header: "Name",
    width: "240px",
    sortable: true,
    cell: (row) => (
      <div className="flex items-center gap-1.5">
        <span className="truncate font-medium text-foreground">
          {row.project_name ?? "—"}
        </span>
        {row.source === "manual" ? (
          // WHY: provenance badge — inline with the name so it's visible
          // wherever the table renders, without claiming its own column.
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            Manual
          </Badge>
        ) : null}
      </div>
    ),
  },
  {
    key: "project_type",
    header: "Type",
    width: "120px",
    nowrap: true,
    sortable: true,
    cell: (row) =>
      row.project_type ? (
        <Badge variant="outline" className="font-normal">
          {row.project_type}
        </Badge>
      ) : (
        <span className="text-meta">—</span>
      ),
  },
  {
    key: "region",
    header: "Region",
    width: "104px",
    nowrap: true,
    sortable: true,
    cell: (row) => (
      <span className="text-muted-foreground">{row.region ?? "—"}</span>
    ),
  },
  {
    key: "contract_value_usd",
    header: "Contract",
    align: "right",
    width: "96px",
    nowrap: true,
    sortable: true,
    cell: (row) => <TabularNumber value={row.contract_value_usd} currency />,
  },
  {
    key: "start_date",
    header: "Duration",
    width: "140px",
    nowrap: true,
    cell: (row) => (
      <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground tabular-nums">
        <span>{formatShortDate(row.start_date)}</span>
        <span aria-hidden className="opacity-50">→</span>
        <span>{formatShortDate(row.end_date)}</span>
      </span>
    ),
  },
  {
    key: "delay_days",
    header: "Delay",
    align: "right",
    width: "76px",
    nowrap: true,
    sortable: true,
    cell: (row) => {
      const v = row.delay_days;
      const bad = typeof v === "number" && v > 30;
      return (
        <TabularNumber
          value={v}
          formatter={(n) => `${n} d`}
          className={cn(bad && "text-[color:var(--anomaly-delay)]")}
        />
      );
    },
  },
  {
    key: "cost_overrun_pct",
    header: "Overrun",
    align: "right",
    width: "88px",
    nowrap: true,
    sortable: true,
    cell: (row) => {
      const v = row.cost_overrun_pct;
      const bad = typeof v === "number" && v > 25;
      return (
        <TabularNumber
          value={v}
          formatter={(n) => formatPercent(n)}
          className={cn(bad && "text-[color:var(--anomaly-cost)]")}
        />
      );
    },
  },
  {
    key: "safety_incidents",
    header: "Safety",
    align: "right",
    width: "72px",
    nowrap: true,
    sortable: true,
    cell: (row) => {
      const v = row.safety_incidents;
      const bad = typeof v === "number" && v > 0;
      return (
        <TabularNumber
          value={v}
          className={cn(bad && "text-[color:var(--anomaly-safety)]")}
        />
      );
    },
  },
  {
    key: "payment_disputes",
    header: "Disputes",
    align: "right",
    width: "80px",
    nowrap: true,
    sortable: true,
    cell: (row) => {
      const v = row.payment_disputes;
      const bad = typeof v === "number" && v > 0;
      return (
        <TabularNumber
          value={v}
          className={cn(bad && "text-[color:var(--anomaly-disputes)]")}
        />
      );
    },
  },
  {
    key: "final_status",
    header: "Status",
    width: "132px",
    nowrap: true,
    sortable: true,
    cell: (row) => (
      <StatusDot
        tone={statusTone(row.final_status)}
        label={row.final_status ?? "—"}
      />
    ),
  },
  {
    key: "anomaly_flags",
    header: "Flags",
    width: "200px",
    cell: (row) => flagsToBadges(row.anomaly_flags),
  },
];

export function ProjectsTable({
  rows,
  onRowClick,
}: {
  rows: ProjectRow[];
  onRowClick?: (row: ProjectRow) => void;
}): ReactElement {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Table2}
        title="No projects in this portfolio"
        description="Upload a CSV to populate the projects table."
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchable
      searchPlaceholder="Search projects…"
      searchAccessor={(row) =>
        `${row.project_name ?? ""} ${row.project_id_external ?? ""}`
      }
      rowKey={(row) => row.id}
      onRowClick={onRowClick}
    />
  );
}
