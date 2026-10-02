"use client";

import type { Settings } from "@/lib/types";
import { saveLearningSettingsAction } from "@/lib/actions/settings";
import { Input, Select, Switch } from "@/components/ui/input";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { MarkdownField } from "./markdown-field";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

export type LearningValues = Settings["learning"] & {
  customSignupContent: string;
};

export function LearningForm({ initial }: { initial: LearningValues }) {
  const t = useT("admin");
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveLearningSettingsAction);
  const notifyOptions = [
    { value: "none", label: t("learningForm.notify.none") },
    { value: "in_app", label: t("learningForm.notify.inApp") },
    { value: "email", label: t("learningForm.notify.email") },
  ];

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title={t("learningForm.access.title")}>
        <SettingsSwitchRow>
          <Switch
            name="allowGuestAccess"
            defaultChecked={initial.allowGuestAccess}
            label={t("learningForm.guest.label")}
            description={t("learningForm.guest.description")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch name="disableSignup" defaultChecked={initial.disableSignup} label={t("learningForm.disableSignup.label")} description={t("learningForm.disableSignup.description")} />
        </SettingsSwitchRow>
        <SettingsRow
          label={t("learningForm.signupContent.label")}
          description={t("learningForm.signupContent.description")}
          htmlFor="customSignupContent"
          error={errors.customSignupContent}
          stacked
        >
          <MarkdownField
            id="customSignupContent"
            name="customSignupContent"
            defaultValue={initial.customSignupContent}
            rows={6}
            placeholder={t("learningForm.signupContent.placeholder")}
            invalid={!!errors.customSignupContent}
            onChange={markDirty}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("learningForm.completion.title")}>
        <SettingsRow
          label={t("learningForm.dwell.label")}
          description={t("learningForm.dwell.description")}
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
          label={t("learningForm.threshold.label")}
          description={t("learningForm.threshold.description")}
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

      <SettingsSection title={t("learningForm.enforcement.title")}>
        <SettingsSwitchRow>
          <Switch
            name="enforceVideoCompletion"
            defaultChecked={initial.enforceVideoCompletion}
            label={t("learningForm.enforceVideo.label")}
            description={t("learningForm.enforceVideo.description")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="enforceAssignmentCompletion"
            defaultChecked={initial.enforceAssignmentCompletion}
            label={t("learningForm.enforceAssignment.label")}
            description={t("learningForm.enforceAssignment.description")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="enforceQuizCompletion"
            defaultChecked={initial.enforceQuizCompletion}
            label={t("learningForm.enforceQuiz.label")}
            description={t("learningForm.enforceQuiz.description")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="preventSkippingVideos"
            defaultChecked={initial.preventSkippingVideos}
            label={t("learningForm.noSkip.label")}
            description={t("learningForm.noSkip.description")}
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title={t("learningForm.home.title")}>
        <SettingsRow label={t("learningForm.defaultHome.label")} description={t("learningForm.defaultHome.description")} htmlFor="defaultHome" error={errors.defaultHome}>
          <Select
            id="defaultHome"
            name="defaultHome"
            defaultValue={initial.defaultHome}
            options={[
              { value: "courses", label: t("learningForm.defaultHome.courses") },
              { value: "dashboard", label: t("learningForm.defaultHome.dashboard") },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label={t("learningForm.notifyCourses.label")}
          description={t("learningForm.notifyCourses.description")}
          htmlFor="notifyOnPublishedCourses"
          error={errors.notifyOnPublishedCourses}
        >
          <Select id="notifyOnPublishedCourses" name="notifyOnPublishedCourses" defaultValue={initial.notifyOnPublishedCourses} options={notifyOptions} />
        </SettingsRow>
        <SettingsRow
          label={t("learningForm.notifyBatches.label")}
          description={t("learningForm.notifyBatches.description")}
          htmlFor="notifyOnPublishedBatches"
          error={errors.notifyOnPublishedBatches}
        >
          <Select id="notifyOnPublishedBatches" name="notifyOnPublishedBatches" defaultValue={initial.notifyOnPublishedBatches} options={notifyOptions} />
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
