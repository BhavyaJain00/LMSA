import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "@/lib/db/defaults";
import {
  type CourseJsonLdInput,
  type JsonLdObject,
  type SeoContext,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  compactJsonLd,
  courseJsonLd,
  credentialJsonLd,
  educationEventJsonLd,
  faqPageJsonLd,
  inferEducationalLevel,
  itemListJsonLd,
  jobPostingJsonLd,
  minorUnitsToDecimal,
  organizationJsonLd,
  parseSalaryRange,
  personJsonLd,
  seoContext,
  serializeJsonLd,
  videoObjectJsonLd,
  websiteJsonLd,
} from "@/lib/seo/jsonld";

/** schema.org builders: required properties for Google's rich results, absolute URLs, empty-value pruning and safe serialization. */

const ORIGIN = "https://learn.example.com";

function ctx(): SeoContext {
  const settings = defaultSettings();
  settings.seo.organizationName = "Example Academy";
  settings.seo.organizationLogoUrl = "/uploads/logo.png";
  settings.seo.sameAs = ["https://www.linkedin.com/company/example", "javascript:alert(1)"];
  return seoContext(settings, ORIGIN);
}

const obj = (v: unknown) => v as JsonLdObject;
const arr = (v: unknown) => v as JsonLdObject[];

function courseInput(overrides: Partial<CourseJsonLdInput> = {}): CourseJsonLdInput {
  return {
    name: "JavaScript Fundamentals",
    description: "Learn variables, functions and the DOM by building small projects.",
    path: "/courses/javascript-fundamentals",
    image: "/uploads/js.png",
    instructors: [{ name: "Maya Patel", url: "/instructors/maya" }],
    category: "Web development",
    keywords: ["javascript", "web"],
    teaches: ["Write functions", "Manipulate the DOM"],
    prerequisites: ["Basic HTML"],
    educationalLevel: "Beginner",
    totalDurationSeconds: 5400,
    lessonCount: 12,
    free: false,
    price: 4900,
    currency: "USD",
    upcoming: false,
    averageRating: 4.66,
    reviewCount: 3,
    reviews: [{ author: "Sam", rating: 5, body: "Great course", date: "2026-05-01T10:00:00.000Z" }],
    instances: [
      {
        name: "Spring cohort",
        path: "/batches/spring",
        startDate: "2026-10-01",
        endDate: "2026-11-26",
        startTime: "18:00",
        endTime: "19:30",
        medium: "online",
        instructors: [{ name: "Maya Patel" }],
      },
    ],
    datePublished: "2026-01-10",
    dateModified: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("serializeJsonLd", () => {
  it("escapes characters that could close the script element or open a comment", () => {
    const json = serializeJsonLd({ "@type": "Course", name: "</script><script>alert(1)</script> <!-- & more" });
    assert.ok(!json.includes("<"), "no raw <");
    assert.ok(!json.includes(">"), "no raw >");
    assert.ok(!json.includes("&"), "no raw &");
    assert.match(json, /\\u003c\/script\\u003e/);
    // Still valid JSON that round-trips to the original text.
    assert.equal((JSON.parse(json) as { name: string }).name, "</script><script>alert(1)</script> <!-- & more");
  });

  it("escapes the JavaScript line separators", () => {
    const json = serializeJsonLd({ name: "a b c" });
    assert.ok(!json.includes(" ") && !json.includes(" "));
    assert.equal((JSON.parse(json) as { name: string }).name, "a b c");
  });

  it("drops empty values recursively", () => {
    const out = compactJsonLd({ a: "", b: null, c: undefined, d: [], e: {}, f: [{ g: "" }], h: 0, i: false, j: " x ", k: Number.NaN });
    assert.deepEqual(out, { h: 0, i: false, j: " x " });
  });
});

describe("site-wide nodes", () => {
  it("Organization has id, name, url, logo and only valid sameAs links", () => {
    const org = organizationJsonLd(ctx());
    assert.equal(org["@context"], "https://schema.org");
    assert.equal(org["@type"], "EducationalOrganization");
    assert.equal(org["@id"], `${ORIGIN}/#organization`);
    assert.equal(org.name, "Example Academy");
    assert.equal(org.url, ORIGIN);
    assert.equal(obj(org.logo).url, `${ORIGIN}/uploads/logo.png`);
    assert.deepEqual(org.sameAs, ["https://www.linkedin.com/company/example"]);
  });

  it("WebSite carries a SearchAction pointing at the catalog search", () => {
    const site = websiteJsonLd(ctx(), { description: "Courses" });
    const action = obj(site.potentialAction);
    assert.equal(action["@type"], "SearchAction");
    assert.equal(obj(action.target).urlTemplate, `${ORIGIN}/courses?search={search_term_string}`);
    assert.equal(action["query-input"], "required name=search_term_string");
    assert.deepEqual(site.publisher, { "@id": `${ORIGIN}/#organization` });
  });

  it("WebSite omits the SearchAction when guests cannot search", () => {
    const site = websiteJsonLd(ctx(), { searchPath: null });
    assert.equal(site.potentialAction, undefined);
    assert.equal(site["@type"], "WebSite");
  });
});

describe("lists and breadcrumbs", () => {
  it("BreadcrumbList numbers items, links all but the last and skips unlinked middle items", () => {
    const list = breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Legal" }, { name: "Privacy" }], { origin: ORIGIN });
    const items = arr(list.itemListElement);
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` });
    assert.deepEqual(items[1], { "@type": "ListItem", position: 2, name: "Privacy" });
  });

  it("ItemList uses absolute URLs and positions", () => {
    const list = itemListJsonLd("Courses", [{ name: "A", path: "/courses/a" }, { name: "B", path: "/courses/b", image: "/uploads/b.png" }], { origin: ORIGIN });
    assert.equal(list.numberOfItems, 2);
    const items = arr(list.itemListElement);
    assert.equal(items[1]!.position, 2);
    assert.equal(items[1]!.url, `${ORIGIN}/courses/b`);
    assert.equal(items[1]!.image, `${ORIGIN}/uploads/b.png`);
  });

  it("FAQPage is null without complete questions and strips markdown from answers", () => {
    assert.equal(faqPageJsonLd([{ question: " ", answer: "x" }]), null);
    const faq = faqPageJsonLd([{ question: "Is it free?", answer: "**Yes**, the first [lesson](/x) is free." }])!;
    const q = arr(faq.mainEntity)[0]!;
    assert.equal(q["@type"], "Question");
    assert.equal(obj(q.acceptedAnswer).text, "Yes, the first lesson is free.");
  });
});

describe("Course", () => {
  it("has provider, offers, instances, rating, reviews and course facts", () => {
    const c = courseJsonLd(courseInput(), ctx());
    assert.equal(c["@type"], "Course");
    assert.equal(c.name, "JavaScript Fundamentals");
    assert.ok(typeof c.description === "string" && c.description.length > 0);
    assert.equal(c.url, `${ORIGIN}/courses/javascript-fundamentals`);
    assert.equal(c.image, `${ORIGIN}/uploads/js.png`);
    assert.equal(c.inLanguage, "en");
    assert.equal(c.educationalLevel, "Beginner");
    assert.equal(c.timeRequired, "PT1H30M");
    assert.deepEqual(c.teaches, ["Write functions", "Manipulate the DOM"]);
    assert.equal(obj(c.provider).name, "Example Academy");

    const offer = obj(c.offers);
    assert.equal(offer.category, "Paid");
    assert.equal(offer.price, "49.00");
    assert.equal(offer.priceCurrency, "USD");
    assert.equal(offer.availability, "https://schema.org/InStock");

    const instances = arr(c.hasCourseInstance);
    assert.equal(instances.length, 2, "cohort + self-paced");
    const cohort = instances[0]!;
    assert.equal(cohort.courseMode, "Online");
    assert.equal(cohort.startDate, "2026-10-01");
    const schedule = obj(cohort.courseSchedule);
    assert.equal(schedule.repeatFrequency, "Weekly");
    assert.equal(schedule.repeatCount, 8);
    assert.equal(schedule.duration, "PT1H30M");
    assert.equal(instances[1]!.courseWorkload, "PT1H30M");

    const rating = obj(c.aggregateRating);
    assert.equal(rating.ratingValue, 4.7);
    assert.equal(rating.reviewCount, 3);
    const review = arr(c.review)[0]!;
    assert.equal(obj(review.author).name, "Sam");
    assert.equal(review.datePublished, "2026-05-01");
  });

  it("marks free and upcoming courses and omits the rating without reviews", () => {
    const c = courseJsonLd(courseInput({ free: true, price: 0, upcoming: true, averageRating: null, reviewCount: 0, reviews: [], instances: [], totalDurationSeconds: 0 }), ctx());
    const offer = obj(c.offers);
    assert.equal(offer.category, "Free");
    assert.equal(offer.price, "0");
    assert.equal(offer.availability, "https://schema.org/PreOrder");
    assert.equal(c.isAccessibleForFree, true);
    assert.equal(c.aggregateRating, undefined);
    assert.equal(c.review, undefined);
    assert.equal(c.hasCourseInstance, undefined);
  });

  it("converts minor units by currency", () => {
    assert.equal(minorUnitsToDecimal(4900, "USD"), "49.00");
    // The app stores price × 100 for every currency (formatPrice divides by 100).
    assert.equal(minorUnitsToDecimal(500000, "JPY"), "5000");
    assert.equal(minorUnitsToDecimal(500000, "jpy"), "5000");
    assert.equal(minorUnitsToDecimal(500000, "KWD"), "5000.000");
    assert.equal(minorUnitsToDecimal(1234, "NOT-A-CODE"), "12.34");
  });

  it("infers the level from tags or title", () => {
    assert.equal(inferEducationalLevel(["beginner"], "Anything"), "Beginner");
    assert.equal(inferEducationalLevel([], "Advanced React patterns"), "Advanced");
    assert.equal(inferEducationalLevel([], "React"), undefined);
  });
});

describe("media, articles and people", () => {
  it("VideoObject has name, description, thumbnail and upload date", () => {
    const v = videoObjectJsonLd({ name: "Preview", description: "", thumbnail: "/uploads/t.png", uploadDate: "2026-01-01", embedPath: "/courses/x", durationSeconds: 90 }, ctx());
    assert.equal(v["@type"], "VideoObject");
    assert.equal(v.description, "Preview", "falls back to the name");
    assert.deepEqual(v.thumbnailUrl, [`${ORIGIN}/uploads/t.png`]);
    assert.equal(v.uploadDate, "2026-01-01");
    assert.equal(v.duration, "PT1M30S");
    assert.equal(v.embedUrl, `${ORIGIN}/courses/x`);
  });

  it("BlogPosting has headline, author Person, publisher Organization with logo and dates", () => {
    const b = blogPostingJsonLd(
      {
        headline: "How to learn JavaScript",
        description: "A plan",
        path: "/blog/learn-js",
        image: "/uploads/cover.png",
        author: { name: "Maya Patel", url: "/instructors/maya" },
        datePublished: "2026-02-01T00:00:00.000Z",
        dateModified: "2026-03-01T00:00:00.000Z",
        keywords: ["js"],
        wordCount: 900,
      },
      ctx(),
    );
    assert.equal(b["@type"], "BlogPosting");
    assert.equal(b.headline, "How to learn JavaScript");
    assert.deepEqual(b.author, { "@type": "Person", name: "Maya Patel", url: `${ORIGIN}/instructors/maya` });
    assert.equal(obj(b.publisher).name, "Example Academy");
    assert.equal(obj(b.publisher).logo, `${ORIGIN}/uploads/logo.png`);
    assert.equal(b.datePublished, "2026-02-01T00:00:00.000Z");
    assert.deepEqual(b.image, [`${ORIGIN}/uploads/cover.png`]);
    assert.deepEqual(b.mainEntityOfPage, { "@type": "WebPage", "@id": `${ORIGIN}/blog/learn-js` });
  });

  it("Person is wrapped in a ProfilePage with valid sameAs links", () => {
    const p = personJsonLd({ name: "Maya", path: "/user/maya", sameAs: ["https://github.com/maya", "not a url"], knowsAbout: ["JS"], description: "**Teacher**" }, ctx());
    assert.equal(p["@type"], "ProfilePage");
    const person = obj(p.mainEntity);
    assert.equal(person["@type"], "Person");
    assert.equal(person.url, `${ORIGIN}/user/maya`);
    assert.deepEqual(person.sameAs, ["https://github.com/maya"]);
    assert.equal(person.description, "Teacher");
  });
});

describe("JobPosting", () => {
  const job = {
    title: "Frontend developer",
    company: "Acme",
    companyLogoUrl: "https://acme.test/logo.png",
    companyWebsite: "https://acme.test",
    location: "Berlin",
    country: "Germany",
    remote: false,
    workMode: "onsite" as const,
    type: "full_time" as const,
    description: "Build UIs.",
    salaryRange: "€50k - €65k per year",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };

  it("has the required Google Jobs properties", () => {
    const j = jobPostingJsonLd({ job, path: "/jobs/frontend", validThrough: "2026-11-30T00:00:00.000Z", currency: "USD" }, ctx());
    assert.equal(j["@type"], "JobPosting");
    assert.equal(j.title, "Frontend developer");
    assert.equal(j.description, "Build UIs.");
    assert.equal(j.datePosted, "2026-09-01T00:00:00.000Z");
    assert.equal(j.validThrough, "2026-11-30T00:00:00.000Z");
    assert.equal(j.employmentType, "FULL_TIME");
    assert.equal(obj(j.hiringOrganization).name, "Acme");
    assert.equal(obj(obj(j.jobLocation).address).addressLocality, "Berlin");
    assert.equal(j.jobLocationType, undefined);
    const salary = obj(j.baseSalary);
    assert.equal(salary.currency, "EUR");
    assert.deepEqual(salary.value, { "@type": "QuantitativeValue", minValue: 50000, maxValue: 65000, unitText: "YEAR" });
  });

  it("marks remote jobs as TELECOMMUTE with an applicant country", () => {
    const j = jobPostingJsonLd({ job: { ...job, workMode: "remote", salaryRange: undefined }, path: "/jobs/x", validThrough: "2026-12-01", currency: "USD" }, ctx());
    assert.equal(j.jobLocationType, "TELECOMMUTE");
    assert.deepEqual(j.applicantLocationRequirements, { "@type": "Country", name: "Germany" });
    assert.equal(j.jobLocation, undefined);
    assert.equal(j.baseSalary, undefined);
  });

  it("parses common salary formats", () => {
    assert.deepEqual(parseSalaryRange("$80k – $100k / year", "EUR"), { currency: "USD", min: 80000, max: 100000, unit: "YEAR" });
    assert.deepEqual(parseSalaryRange("12 LPA", "USD"), { currency: "INR", min: 1200000, max: undefined, unit: "YEAR" });
    assert.deepEqual(parseSalaryRange("GBP 25 per hour", "USD"), { currency: "GBP", min: 25, max: undefined, unit: "HOUR" });
    assert.equal(parseSalaryRange("Competitive", "USD"), null);
    assert.equal(parseSalaryRange(undefined, "USD"), null);
  });
});

describe("credentials and events", () => {
  it("EducationalOccupationalCredential identifies the certificate and what it was earned for", () => {
    const c = credentialJsonLd(
      { name: "JS certificate", description: "Completion", path: "/certificates/LL-1", code: "LL-1", recipient: "Sam", issueDate: "2026-06-01", aboutName: "JS", aboutPath: "/courses/js" },
      ctx(),
    );
    assert.equal(c["@type"], "EducationalOccupationalCredential");
    assert.equal(c.credentialCategory, "certificate");
    assert.equal(obj(c.identifier).value, "LL-1");
    assert.equal(obj(c.recognizedBy).name, "Example Academy");
    assert.equal(obj(c.about).url, `${ORIGIN}/courses/js`);
    assert.equal(c.expires, undefined);
  });

  it("EducationEvent has dates, attendance mode, location and offer", () => {
    const e = educationEventJsonLd(
      {
        name: "Live Q&A",
        startDate: "2026-10-01T18:00:00.000Z",
        endDate: "2026-10-01T19:00:00.000Z",
        path: "/batches/spring",
        performers: [{ name: "Maya" }],
        online: true,
        offer: { free: false, price: 19900, currency: "USD" },
      },
      ctx(),
    );
    assert.equal(e["@type"], "EducationEvent");
    assert.equal(e.eventAttendanceMode, "https://schema.org/OnlineEventAttendanceMode");
    assert.deepEqual(e.location, { "@type": "VirtualLocation", url: `${ORIGIN}/batches/spring` });
    assert.equal(obj(e.offers).price, "199.00");
    assert.equal(arr(e.performer)[0]!.name, "Maya");
  });
});
