"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";

/** Look up a certificate by its verification code. */
export function VerifyForm({ defaultCode = "" }: { defaultCode?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(defaultCode);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim().toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9-]{4,40}$/.test(value)) {
      setError("Enter the certificate ID shown on the certificate, e.g. LL-7K2M-Q9ZX.");
      return;
    }
    setError(null);
    router.push(`/certificates/${encodeURIComponent(value)}`);
  };

  return (
    <form onSubmit={submit} className="w-full max-w-md" noValidate>
      <label htmlFor="verify-code" className="mb-1.5 block text-sm font-medium text-ink">
        Certificate ID
      </label>
      <div className="flex gap-2">
        <Input
          id="verify-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="LL-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          invalid={!!error}
          leftAddon={<Icon.ShieldCheck className="size-4" />}
          className="font-mono uppercase"
        />
        <Button type="submit">Verify</Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </form>
  );
}
