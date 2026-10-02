"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { loginAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Label } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { PasswordField } from "@/components/security/password-field";
import { useT } from "@/i18n/client";

export function LoginForm({ next, defaultEmail }: { next?: string; defaultEmail?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const t = useT("auth");
  const forgotHref = email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : "/forgot-password";

  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormError message={state && !state.ok ? state.error : null} />
      <Field label={t("fields.email")} htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder={t("fields.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          leftAddon={<Icon.Mail className="size-4" />}
        />
      </Field>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="password" required>
            {t("fields.password")}
          </Label>
          <Link href={forgotHref} className="mb-1.5 text-xs font-medium text-accent hover:underline">
            {t("login.forgot")}
          </Link>
        </div>
        <PasswordField id="password" name="password" autoComplete="current-password" required placeholder="••••••••" />
      </div>
      <Button type="submit" className="w-full" loading={pending} size="lg">
        {t("login.submit")}
      </Button>
    </form>
  );
}
