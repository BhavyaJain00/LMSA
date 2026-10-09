import { Instrument_Serif, Space_Grotesk } from "next/font/google";

/*
 * Display faces for the guest home page only (the editorial look: bold grotesk capitals mixed with italic
 * serif words). Declared here so they are downloaded only where the landing components are used.
 * Both cover Latin; Arabic and Devanagari glyphs fall back to the interface stack.
 */
export const displayFont = Space_Grotesk({ subsets: ["latin", "latin-ext"], weight: ["700"], variable: "--font-display", display: "swap" });
export const editorialFont = Instrument_Serif({ subsets: ["latin", "latin-ext"], weight: "400", style: ["italic"], variable: "--font-editorial", display: "swap" });

/** Class names that make both faces available inside the landing page. */
export const landingFontVariables = `${displayFont.variable} ${editorialFont.variable}`;

/** Tailwind classes for the two faces, with the interface stack (and its script faces) behind them. */
export const DISPLAY = "[font-family:var(--font-display),var(--font-script,var(--font-ui)),sans-serif]";
export const EDITORIAL = "[font-family:var(--font-editorial),var(--font-script,var(--font-ui)),serif]";
