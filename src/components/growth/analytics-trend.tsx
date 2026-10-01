"use client";

import { useState } from "react";
import { LineChart } from "@/components/dashboard/charts/line-chart";
import type { ChartTone } from "@/components/dashboard/charts/scale";
import { SegmentedControl } from "@/components/ui/tabs";

export interface TrendDay {
  date: string;
  visits: number;
  pageViews: number;
  signups: number;
  orders: number;
  /** Net revenue in major units. */
  revenue: number;
}

type Metric = "visits" | "pageViews" | "signups" | "orders" | "revenue";

/** Daily trend of one metric at a time (visits, page views, sign-ups, orders, net revenue). */
export function AnalyticsTrend({ days, currency }: { days: TrendDay[]; currency: string }) {
  const [metric, setMetric] = useState<Metric>("visits");
  const series: Record<Metric, { label: string; unit: string; tone: ChartTone }> = {
    visits: { label: "Visits", unit: "visit", tone: "accent" },
    pageViews: { label: "Page views", unit: "page view", tone: "info" },
    signups: { label: "Sign-ups", unit: "sign-up", tone: "success" },
    orders: { label: "Orders", unit: "order", tone: "warning" },
    revenue: { label: `Net revenue (${currency})`, unit: "", tone: "success" },
  };
  const s = series[metric];
  return (
    <div className="space-y-4">
      <div className="no-scrollbar overflow-x-auto">
        <SegmentedControl<Metric>
          value={metric}
          onChange={setMetric}
          options={[
            { value: "visits", label: "Visits" },
            { value: "pageViews", label: "Page views" },
            { value: "signups", label: "Sign-ups" },
            { value: "orders", label: "Orders" },
            { value: "revenue", label: "Revenue" },
          ]}
        />
      </div>
      <LineChart key={metric} data={days.map((d) => ({ date: d.date, value: d[metric] }))} label={s.label} unit={s.unit} tone={s.tone} />
    </div>
  );
}
