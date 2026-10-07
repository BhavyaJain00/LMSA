import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACES, type Locale, type Namespace } from "@/i18n/config";
import { catalogMessages, englishMessages } from "@/i18n/catalog";
import { formatMessage, pluralSelectors } from "@/i18n/format";
import type { MessageVars } from "@/i18n/types";

const msg = (locale: Locale, namespace: Namespace, key: string, vars: MessageVars) => {
  const template = catalogMessages(locale, namespace)[key];
  assert.ok(template, `${namespace}:${key} exists`);
  return formatMessage(template, vars, locale);
};

describe("i18n plurals: counted messages inflect in English", () => {
  it("billing intervals read naturally for one and many", () => {
    assert.equal(msg("en", "account", "commerce.interval.weeks", { count: 1 }), "every week");
    assert.equal(msg("en", "account", "commerce.interval.weeks", { count: 2 }), "every 2 weeks");
    assert.equal(msg("en", "account", "commerce.interval.days", { count: 1 }), "every day");
    assert.equal(msg("en", "account", "commerce.interval.days", { count: 45 }), "every 45 days");
  });

  it("progress lines agree with the total", () => {
    assert.equal(msg("en", "account", "commerce.plan.progress", { paid: 1, total: 1, amount: "$10" }), "1 of 1 payment made · $10 paid");
    assert.equal(msg("en", "account", "commerce.plan.progress", { paid: 1, total: 3, amount: "$10" }), "1 of 3 payments made · $10 paid");
    assert.equal(msg("en", "learning", "exercise.somePassed", { passed: 0, total: 1 }), "0 of 1 test passed.");
    assert.equal(msg("en", "learning", "exercise.somePassed", { passed: 2, total: 5 }), "2 of 5 tests passed.");
    assert.equal(msg("en", "learning", "peer.admin.reviewsIn", { completed: 0, assigned: 1 }), "0/1 review in");
    assert.equal(msg("en", "public", "programs.detail.finished", { done: 1, total: 1 }), "1 of 1 course completed. Congratulations on finishing the program!");
    assert.equal(
      msg("en", "learning", "learn.topBar.progressLabel", { percent: 50, completed: 1, total: 2 }),
      "Course progress: 50% (1 of 2 lessons)",
    );
  });

  it("confirmations and hints agree with their count", () => {
    assert.equal(msg("en", "admin", "backups.delete.titleMany", { count: 3 }), "Delete 3 backups?");
    assert.equal(msg("en", "public", "blogAdmin.deleteMany", { count: 1 }), "Delete 1 article?");
    assert.equal(msg("en", "admin", "members.form.passwordHint", { count: 1 }), "At least 1 character, with letters and numbers.");
    assert.equal(msg("en", "admin", "members.form.passwordHint", { count: 12 }), "At least 12 characters, with letters and numbers.");
    assert.match(msg("en", "admin", "members.import.passwordHelp", { count: 8 }), /^At least 8 characters, with letters and numbers\. Leave empty/);
  });

  it("formats the count with the locale's grouping", () => {
    assert.equal(msg("en", "learning", "quizAdmin.bank.partlyDeleted", { deleted: 1, total: 1200 }), "1 of 1,200 questions deleted; the others are still selected");
  });

  it("no English message puts a count variable straight before a plural noun", () => {
    // `{count} weeks` breaks at 1 ("every 1 weeks") and leaves translators no plural to inflect.
    const COUNT_VARS = /\{(count|total|assigned|deleted|failed|passed)\}\s+(?:[a-z]+\s+)?(lessons|courses|weeks|days|backups|articles|payments|quizzes|questions|submissions|tests|reviews|characters|instructors)\b/;
    const offenders: string[] = [];
    for (const namespace of NAMESPACES) {
      for (const [key, template] of Object.entries(englishMessages(namespace))) {
        const outside = template.replace(/\{\w+,\s*(plural|selectordinal)[\s\S]*$/, "");
        if (COUNT_VARS.test(outside)) offenders.push(`${namespace}:${key}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe("i18n plurals: translations use each language's categories", () => {
  it("Arabic uses the dual and the 11+ singular", () => {
    assert.equal(msg("ar", "account", "commerce.interval.weeks", { count: 1 }), "كل أسبوع");
    assert.equal(msg("ar", "account", "commerce.interval.weeks", { count: 2 }), "كل أسبوعين");
    assert.equal(msg("ar", "account", "commerce.interval.weeks", { count: 3 }), "كل 3 أسابيع");
    assert.equal(msg("ar", "account", "commerce.interval.weeks", { count: 12 }), "كل 12 أسبوعًا");
    assert.equal(msg("ar", "account", "commerce.interval.days", { count: 2 }), "كل يومين");
    assert.equal(msg("ar", "admin", "backups.delete.titleMany", { count: 2 }), "هل تريد حذف نسختين احتياطيتين؟");
    assert.equal(msg("ar", "admin", "backups.delete.titleMany", { count: 5 }), "هل تريد حذف 5 نسخ احتياطية؟");
    assert.equal(msg("ar", "learning", "quizAdmin.bank.partlyDeleted", { deleted: 3, total: 20 }), "حُذف 3 من 20 سؤالًا، وما زالت البقية محددة");
  });

  it("French and Spanish switch between singular and plural", () => {
    assert.equal(msg("fr", "account", "commerce.interval.weeks", { count: 1 }), "chaque semaine");
    assert.equal(msg("fr", "account", "commerce.interval.weeks", { count: 3 }), "toutes les 3 semaines");
    assert.equal(msg("fr", "learning", "quizAdmin.submissions.partlyDeleted", { failed: 1, total: 4 }), "1 envoi sur 4 n'a pas pu être supprimé");
    assert.equal(msg("es", "account", "dashboard.cards.lessonsDone", { done: 1, total: 1 }), "1/1 lección");
    assert.equal(msg("es", "admin", "members.form.passwordHint", { count: 10 }), "Al menos 10 caracteres, con letras y números.");
  });

  it("Hindi drops the number for a single week", () => {
    assert.equal(msg("hi", "account", "commerce.interval.weeks", { count: 1 }), "हर हफ़्ते");
    assert.equal(msg("hi", "account", "commerce.interval.weeks", { count: 4 }), "हर 4 हफ़्ते");
  });

  it("the rewritten English sources are plurals", () => {
    const keys: [Namespace, string][] = [
      ["account", "commerce.interval.weeks"],
      ["account", "commerce.plan.progressToGo"],
      ["admin", "members.import.passwordHelp"],
      ["learning", "quizAdmin.quizzes.partlyDeleted"],
      ["public", "enroll.installmentOffer"],
      ["public", "instructors.meta.descriptionCount"],
    ];
    for (const [namespace, key] of keys) {
      const selectors = Object.values(pluralSelectors(englishMessages(namespace)[key]!));
      assert.ok(selectors.length > 0 && selectors.every((s) => s.includes("one") && s.includes("other")), `${namespace}:${key}`);
    }
  });
});
