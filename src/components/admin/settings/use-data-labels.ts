"use client";

import { useCallback } from "react";
import { useT } from "@/i18n/client";

/**
 * Translated name of a database collection (Backup & reset), falling back to
 * the English label from `data-labels.ts` for collections without a message.
 */
export function useCollectionLabel(): (name: string, fallback: string) => string {
  const t = useT("admin");
  return useCallback(
    (name: string, fallback: string) => {
      const key = `backups.collections.${name}`;
      return t.has(key) ? t(key) : fallback;
    },
    [t],
  );
}
