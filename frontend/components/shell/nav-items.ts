import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Lightbulb,
  MessageSquare,
  Radar,
  Table2,
} from "lucide-react";

export type NavItem = {
  label: string;
  segment: string | null; // null = index route
  href: (portfolioId: string) => string;
  icon: LucideIcon;
  description?: string;
};

export const PORTFOLIO_NAV_ITEMS: NavItem[] = [
  {
    label: "Overview",
    segment: null,
    href: (id) => `/portfolios/${id}`,
    icon: LayoutDashboard,
    description: "Portfolio-wide KPIs and charts",
  },
  {
    label: "Screen",
    segment: "screen",
    href: (id) => `/portfolios/${id}/screen`,
    icon: ClipboardList,
    description: "Score a hypothetical project against the portfolio",
  },
  {
    label: "Projects",
    segment: "projects",
    href: (id) => `/portfolios/${id}/projects`,
    icon: Table2,
    description: "Per-project rows with anomaly flags",
  },
  {
    label: "Anomalies",
    segment: "anomalies",
    href: (id) => `/portfolios/${id}/anomalies`,
    icon: AlertTriangle,
    description: "Flagged projects grouped by rule",
  },
  {
    label: "Insights",
    segment: "insights",
    href: (id) => `/portfolios/${id}/insights`,
    icon: Lightbulb,
    description: "Auto-generated patterns and learnings",
  },
  {
    label: "Monitor",
    segment: "monitor",
    href: (id) => `/portfolios/${id}/monitor`,
    icon: Radar,
    description: "Live in-progress projects with risk scores",
  },
  {
    label: "Models",
    segment: "models",
    href: (id) => `/portfolios/${id}/models`,
    icon: BarChart3,
    description: "Naive vs. pre-construction comparison",
  },
  {
    label: "Documents",
    segment: "documents",
    href: (id) => `/portfolios/${id}/documents`,
    icon: FileText,
    description: "Upload and embed project docs",
  },
  {
    label: "Ask",
    segment: "ask",
    href: (id) => `/portfolios/${id}/ask`,
    icon: MessageSquare,
    description: "Chat with your documents",
  },
];
