import type { ComponentProps } from "react";
import { PublicI18n } from "@/components/catalog/public-i18n";
import { PostEditor as PostEditorClient } from "./post-editor-client";

export type { PostEditorValues } from "./post-editor-client";

/** Article editor of /admin/blog; see `./post-editor-client.tsx`. Provides its messages (admin pages sit outside the public group's layouts). */
export function PostEditor(props: ComponentProps<typeof PostEditorClient>) {
  return (
    <PublicI18n pick={["blogAdmin.", "blog.readingTime", "blog.faq.title"]}>
      <PostEditorClient {...props} />
    </PublicI18n>
  );
}
