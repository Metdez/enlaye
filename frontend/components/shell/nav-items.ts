import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  FileText,
  LayoutDashboard,
  MessageSquare,
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
