/** Accepted ranges for Settings → Video (shared by the form and the server action). */
export const VIDEO_SETTINGS_LIMITS = {
  watermarkOpacity: { min: 0.05, max: 0.5 },
  signedUrlMinutes: { min: 5, max: 240 },
} as const;
