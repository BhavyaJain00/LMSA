import { getT } from "@/i18n/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LanguageOptions } from "./language-switcher";

/** "Language" card for the account settings page (saved to the account and the cookie). */
export async function LanguageSettingsCard({ signedIn = true }: { signedIn?: boolean }) {
  const t = await getT("common");
  return (
    <Card id="language">
      <CardHeader title={t("language.settingsTitle")} description={t("language.settingsDescription")} />
      <CardBody className="space-y-3">
        <LanguageOptions />
        <p className="text-xs text-ink-muted">{signedIn ? t("language.savedToAccount") : t("language.savedToDevice")}</p>
      </CardBody>
    </Card>
  );
}
