"use client";

import type { Settings } from "@/lib/types";
import { saveFeatureSettingsAction } from "@/lib/actions/settings";
import { Switch } from "@/components/ui/input";
import { SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

type FeatureKey = keyof Settings["features"];

const GROUPS: { title: string; description: string; items: { key: FeatureKey; label: string; description: string }[] }[] = [
  {
    title: "Learning experiences",
    description: "What learners can take part in.",
    items: [
      { key: "courses", label: "Courses", description: "Course catalog, course pages and the lesson player." },
      { key: "batches", label: "Batches", description: "Cohort-based batches with timetables, assessments and announcements." },
      { key: "programs", label: "Programs", description: "Learning paths that bundle several courses in order." },
      { key: "liveClasses", label: "Live classes", description: "Scheduled live sessions inside batches, with recordings." },
      { key: "programmingExercises", label: "Programming exercises", description: "In-browser coding exercises checked against test cases." },
    ],
  },
  {
    title: "Community",
    description: "Ways learners interact with each other and with instructors.",
    items: [
      { key: "discussions", label: "Discussions", description: "Question & answer threads on lessons, courses and batches." },
      { key: "reviews", label: "Reviews", description: "Course ratings and written reviews on course pages." },
      { key: "notes", label: "Notes", description: "Personal lesson notes and highlights for learners." },
      { key: "badges", label: "Badges", description: "Achievement badges awarded automatically or by hand." },
      { key: "notifications", label: "Notifications", description: "In-app notifications and the notification bell." },
    ],
  },
  {
    title: "Career & credentials",
    description: "Certificates and job opportunities.",
    items: [
      { key: "certifications", label: "Certifications", description: "Certificates, evaluations and paid certificates." },
      { key: "certifiedMembers", label: "Certified members", description: "Public directory of members who earned certificates." },
      { key: "jobs", label: "Jobs", description: "The job board where members browse, post and apply to openings." },
    ],
  },
  {
    title: "Insights",
    description: "Reporting for staff.",
    items: [{ key: "statistics", label: "Statistics", description: "Platform statistics for instructors and moderators." }],
  },
];

export function FeaturesForm({ initial }: { initial: Settings["features"] }) {
  const { onSubmit, pending, dirty, markDirty, state } = useFormAction(saveFeatureSettingsAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} className="space-y-6">
      {GROUPS.map((group) => (
        <SettingsSection key={group.title} title={group.title} description={group.description}>
          {group.items.map((item) => (
            <SettingsSwitchRow key={item.key}>
              <Switch id={`feature-${item.key}`} name={item.key} defaultChecked={initial[item.key]} label={item.label} description={item.description} />
            </SettingsSwitchRow>
          ))}
        </SettingsSection>
      ))}
      <p className="text-xs text-ink-muted">Turning a feature off hides it from navigation and blocks its pages. Existing data is kept and reappears when you turn it back on.</p>
      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} />
    </form>
  );
}
