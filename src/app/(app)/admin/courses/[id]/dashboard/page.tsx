import { redirect } from "next/navigation";

/** Deep link used by enrollment notifications: forwards to the Dashboard tab. */
export default async function CourseDashboardRedirect(props: PageProps<"/admin/courses/[id]/dashboard">) {
  const { id } = await props.params;
  redirect(`/admin/courses/${id}?tab=dashboard`);
}
