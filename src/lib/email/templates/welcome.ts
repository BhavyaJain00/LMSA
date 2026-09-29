import { type EmailBrand, type EmailBlock, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export interface WelcomeEmailData {
  name: string;
  /** Where "Start learning" points (default: the course catalog). */
  startUrl?: string;
  /** When the account still has to confirm its address. */
  verifyUrl?: string;
  footer?: EmailFooter;
}

/** Sent once after sign-up. */
export function welcomeEmail(brand: EmailBrand, data: WelcomeEmailData): RenderedEmail {
  const subject = `Welcome to ${brand.name}`;
  const blocks: EmailBlock[] = [{ type: "paragraph", text: `Your ${brand.name} account is ready. We're glad you're here.` }];
  if (data.verifyUrl) {
    blocks.push(
      {
        type: "callout",
        tone: "info",
        title: "Confirm your email address",
        text: "Please confirm that this address belongs to you so we can keep your account secure.",
      },
      { type: "button", label: "Confirm email address", url: data.verifyUrl, fallback: true },
    );
  }
  blocks.push(
    { type: "paragraph", text: "Here are a few ways to get started:" },
    {
      type: "list",
      items: [
        "Browse the catalog and enroll in a course that matches your goals.",
        "Join a batch to learn with a cohort, attend live classes and get feedback.",
        "Track your progress, keep your streak going and earn certificates.",
      ],
    },
    { type: "button", label: "Start learning", url: data.startUrl ?? "/courses" },
    { type: "muted", text: "You can change which emails you receive at any time from your email preferences." },
  );
  return renderEmail(brand, subject, {
    preheader: `Your ${brand.name} account is ready — here's how to get started.`,
    heading: `Welcome, ${firstName(data.name)}!`,
    blocks,
    signoff: ["Happy learning,", `The ${brand.name} team`],
    footer: data.footer,
  });
}
