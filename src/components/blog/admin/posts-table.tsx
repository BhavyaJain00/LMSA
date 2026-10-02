import type { ComponentProps } from "react";
import { PublicI18n } from "@/components/catalog/public-i18n";
import { PostsTable as PostsTableClient } from "./posts-table-client";

export type { PostRowView } from "./posts-table-client";

/** Article list of /admin/blog; see `./posts-table-client.tsx`. Provides its messages (admin pages sit outside the public group's layouts). */
export function PostsTable(props: ComponentProps<typeof PostsTableClient>) {
  return (
    <PublicI18n pick={["blogAdmin.", "blog.index.showAll", "blog.index.emptyTitle"]}>
      <PostsTableClient {...props} />
    </PublicI18n>
  );
}
