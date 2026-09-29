"use client";

import type { Settings } from "@/lib/types";
import { saveLearningSettingsAction } from "@/lib/actions/settings";
import { Input, Select, Switch } from "@/components/ui/input";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { MarkdownField } from "./markdown-field";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

export type LearningValues = Settings["learning"] & {
  customSignupContent: string;
};

const NOTIFY_OPTIONS = [
  { value: "none", label: "Don't notify" },
  { value: "in_app", label: "In-app" },
  { value: "email", label: "Email" },
];

export function LearningForm({ initial }: { initial: LearningValues }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveLearningSettingsAction);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Access & Availability">
        <SettingsSwitchRow>
          <Switch
            name="allowGuestAccess"
            defaultChecked={initial.allowGuestAccess}
            label="Allow Guest Access"
            description="If enabled, users can access the course and batch lists and preview lessons without logging in."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch name="disableSignup" defaultChecked={initial.disableSignup} label="Disable signup" description="New users will have to be manually registered by Admins." />
        </SettingsSwitchRow>
        <SettingsRow
          label="Signup page content"
          description="Markdown shown on the signup page, e.g. for consent notices or terms of service."
          htmlFor="customSignupContent"
          error={errors.customSignupContent}
          stacked
        >
          <MarkdownField
            id="customSignupContent"
            name="customSignupContent"
            defaultValue={initial.customSignupContent}
            rows={6}
            placeholder="By creating an account you agree to our **Terms of Service**."
            invalid={!!errors.customSignupContent}
            onChange={markDirty}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Completion Time">
        <SettingsRow
          label="Lesson Completion Time (seconds)"
          description="Seconds a learner must stay on a text lesson before it can be marked complete."
          htmlFor="lessonDwellTimeSeconds"
          error={errors.lessonDwellTimeSeconds}
          required
        >
          <Input
            id="lessonDwellTimeSeconds"
            name="lessonDwellTimeSeconds"
            type="number"
            min={1}
            max={3600}
            step={1}
            defaultValue={initial.lessonDwellTimeSeconds}
            invalid={!!errors.lessonDwellTimeSeconds}
          />
        </SettingsRow>
        <SettingsRow
          label="Video completion threshold (%)"
          description="How much of a video counts as watched when video completion is enforced."
          htmlFor="videoCompletionThreshold"
          error={errors.videoCompletionThreshold}
          required
        >
          <Input
            id="videoCompletionThreshold"
            name="videoCompletionThreshold"
            type="number"
            min={1}
            max={100}
            step={1}
            defaultValue={initial.videoCompletionThreshold}
            invalid={!!errors.videoCompletionThreshold}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Enforcement">
        <SettingsSwitchRow>
          <Switch
            name="enforceVideoCompletion"
            defaultChecked={initial.enforceVideoCompletion}
            label="Enforce video completion"
            description="When enabled, lessons that contain a video can only be marked complete by playing the video to the end. If the video fails to load, the dwell timer is used as a fallback."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="enforceAssignmentCompletion"
            defaultChecked={initial.enforceAssignmentCompletion}
            label="Enforce assignment completion"
            description="When enabled, lessons with an assignment cannot be marked complete until the assignment is submitted."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="enforceQuizCompletion"
            defaultChecked={initial.enforceQuizCompletion}
            label="Enforce quiz completion"
            description="When enabled, lessons with a quiz cannot be marked complete until the quiz is passed."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="preventSkippingVideos"
            defaultChecked={initial.preventSkippingVideos}
            label="Prevent Skipping Videos"
            description="If enabled, learners cannot seek forward past the furthest point they have watched."
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title="Home & Notifications">
        <SettingsRow label="Default home page" description="Where signed-in members land when they open the site." htmlFor="defaultHome" error={errors.defaultHome}>
          <Select
            id="defaultHome"
            name="defaultHome"
            defaultValue={initial.defaultHome}
            options={[
              { value: "courses", label: "Courses" },
              { value: "dashboard", label: "Dashboard" },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label="Send Notification for Published Courses"
          description="Notify members when a new course is published."
          htmlFor="notifyOnPublishedCourses"
          error={errors.notifyOnPublishedCourses}
        >
          <Select id="notifyOnPublishedCourses" name="notifyOnPublishedCourses" defaultValue={initial.notifyOnPublishedCourses} options={NOTIFY_OPTIONS} />
        </SettingsRow>
        <SettingsRow
          label="Send Notification for Published Batches"
          description="Notify members when a new batch is published."
          htmlFor="notifyOnPublishedBatches"
          error={errors.notifyOnPublishedBatches}
        >
          <Select id="notifyOnPublishedBatches" name="notifyOnPublishedBatches" defaultValue={initial.notifyOnPublishedBatches} options={NOTIFY_OPTIONS} />
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
