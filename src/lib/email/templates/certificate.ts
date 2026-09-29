import { type EmailBrand, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export interface CertificateEmailData {
  name: string;
  courseTitle: string;
  /** Public verification code, e.g. "LL-8F3K-2Q9Z". */
  code: string;
  /** Formatted issue date. */
  issueDate: string;
  expiryDate?: string;
  evaluatorName?: string;
  /** Public certificate page. */
  certificateUrl: string;
  /** Override the subject (e.g. with the in-app notification subject). */
  subject?: string;
  footer?: EmailFooter;
}

/** Certificate issued. */
export function certificateIssuedEmail(brand: EmailBrand, data: CertificateEmailData): RenderedEmail {
  const subject = data.subject ?? `Your certificate for ${data.courseTitle} is ready`;
  return renderEmail(brand, subject, {
    preheader: `Congratulations on completing ${data.courseTitle}!`,
    eyebrow: "Certificate",
    heading: `Congratulations, ${firstName(data.name)}!`,
    blocks: [
      { type: "paragraph", text: `You've earned a certificate for ${data.courseTitle}. Share it on your profile, add it to your résumé or download it as a PDF.` },
      {
        type: "details",
        rows: [
          { label: "Course", value: data.courseTitle },
          { label: "Issued", value: data.issueDate },
          { label: "Valid until", value: data.expiryDate ?? "" },
          { label: "Evaluated by", value: data.evaluatorName ?? "" },
        ],
      },
      { type: "code", label: "Verification code", text: data.code },
      { type: "button", label: "View your certificate", url: data.certificateUrl },
      { type: "muted", text: "Anyone can confirm the certificate is genuine by opening the link above or entering the verification code on our certificates page." },
    ],
    signoff: ["Well done,", `The ${brand.name} team`],
    footer: data.footer,
  });
}
