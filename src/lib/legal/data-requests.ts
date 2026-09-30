import type { DataRequest, User } from "@/lib/types";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { DELETED_USER_NAME, isDeletedAccount } from "./erase";

/**
 * Personal-data requests (`DataRequest`: "Download my data" exports and
 * account deletions) as the administrator sees them on the audit page and in
 * its CSV export. Pure: unit tested directly.
 */

export type DataRequestTypeFilter = "all" | DataRequest["type"];

export interface DataRequestFilter {
  type: DataRequestTypeFilter;
  /** Free text: member name, email, username or request id. */
  q: string;
}

export interface DataRequestRow {
  id: string;
  type: DataRequest["type"];
  status: DataRequest["status"];
  createdAt: string;
  completedAt?: string;
  userId: string;
  /** "Deleted user" once the account was erased (or no longer exists). */
  name: string;
  /** Empty once the account was erased. */
  email: string;
  username: string;
  /** The account was erased (or removed): nothing personal is left to show or export. */
  erased: boolean;
}

export const DATA_REQUEST_TYPE_LABELS: Record<DataRequest["type"], string> = {
  export: "Data download",
  delete: "Account deletion",
};

export const DATA_REQUEST_STATUS_LABELS: Record<DataRequest["status"], string> = {
  pending: "Pending",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function parseDataRequestFilter(get: (key: string) => string): DataRequestFilter {
  const type = get("type");
  return {
    type: type === "export" || type === "delete" ? type : "all",
    q: get("q").slice(0, 200),
  };
}

/** Requests joined with their members, filtered, newest first. */
export function dataRequestRows(requests: readonly DataRequest[], users: readonly User[], filter: DataRequestFilter): DataRequestRow[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  const needle = filter.q.trim().toLowerCase();
  const rows: DataRequestRow[] = [];
  for (const r of requests) {
    if (filter.type !== "all" && r.type !== filter.type) continue;
    const user = byId.get(r.userId);
    const erased = !user || isDeletedAccount(user);
    const row: DataRequestRow = {
      id: r.id,
      type: r.type,
      status: r.status,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      userId: r.userId,
      name: erased ? DELETED_USER_NAME : user.name,
      email: erased ? "" : user.email,
      username: erased ? "" : user.username,
      erased,
    };
    if (needle && !`${row.name} ${row.email} ${row.username} ${row.id} ${row.userId}`.toLowerCase().includes(needle)) continue;
    rows.push(row);
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Number of requests per type (for the tab counters). */
export function countDataRequests(requests: readonly DataRequest[]): Record<DataRequestTypeFilter, number> {
  const counts: Record<DataRequestTypeFilter, number> = { all: requests.length, export: 0, delete: 0 };
  for (const r of requests) counts[r.type]++;
  return counts;
}

/** CSV (with header row) of data requests for record keeping. */
export function dataRequestsToCsv(rows: readonly DataRequestRow[]): string {
  const header = ["Request id", "Type", "Status", "Requested (UTC)", "Completed (UTC)", "Member id", "Member", "Email"];
  return toCsv([
    header,
    ...rows.map((r) => [r.id, DATA_REQUEST_TYPE_LABELS[r.type], DATA_REQUEST_STATUS_LABELS[r.status], r.createdAt, r.completedAt ?? "", r.userId, r.name, r.email]),
  ]);
}
