"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Question, QuestionOption } from "@/lib/types";
import { getCurrentUser, isCreator } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { auditEach } from "@/lib/audit";
import { uid } from "@/lib/utils";
import { canEditQuestion, questionUsage, searchQuestionBank, type BankScope } from "@/lib/data/quiz";
import {
  fromUiType,
  MAX_OPTIONS,
  MAX_POSSIBILITIES,
  validateQuestionInput,
  type QuestionBankItem,
  type QuestionInput,
  type UiQuestionType,
} from "@/components/quiz/types";

const MAX_TEXT = 10000;
const MAX_OPTION_TEXT = 1000;
const MAX_EXPLANATION = 2000;

function revalidateBank() {
  revalidatePath("/admin/questions");
  revalidatePath("/(app)/admin/questions/[id]", "page");
  revalidatePath("/(app)/admin/quizzes/[id]", "page");
}

/** Normalise the editor payload into the stored shape (drops blank rows, keeps option ids stable). */
function normalizeQuestion(input: QuestionInput, existing: Question | null, questionId: string): Pick<Question, "text" | "type" | "multiple" | "marks" | "options" | "possibilities"> {
  const { type, multiple } = fromUiType(input.uiType);
  const knownIds = new Set(existing?.options.map((o) => o.id) ?? []);
  const usedIds = new Set<string>();
  const options: QuestionOption[] =
    type === "choices"
      ? input.options
          .filter((o) => o.text.trim())
          .slice(0, MAX_OPTIONS)
          .map((o) => {
            let id = o.id && knownIds.has(o.id) && !usedIds.has(o.id) ? o.id : `${questionId}_${uid("o").slice(2, 10)}`;
            while (usedIds.has(id)) id = `${questionId}_${uid("o").slice(2, 10)}`;
            usedIds.add(id);
            const explanation = o.explanation.trim().slice(0, MAX_EXPLANATION);
            return { id, text: o.text.trim().slice(0, MAX_OPTION_TEXT), isCorrect: !!o.isCorrect, ...(explanation ? { explanation } : {}) };
          })
      : [];
  const seen = new Set<string>();
  const possibilities =
    type === "user_input"
      ? input.possibilities
          .map((p) => p.trim().slice(0, 500))
          .filter((p) => {
            const key = p.toLowerCase();
            if (!p || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, MAX_POSSIBILITIES)
      : [];
  return {
    text: input.text.trim().slice(0, MAX_TEXT),
    type,
    multiple: type === "choices" && multiple,
    marks: input.marks,
    options,
    possibilities,
  };
}

function sanitizeInput(raw: QuestionInput): QuestionInput {
  const uiTypes: UiQuestionType[] = ["single", "multiple", "user_input", "open_ended"];
  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : undefined,
    text: typeof raw?.text === "string" ? raw.text : "",
    uiType: uiTypes.includes(raw?.uiType) ? raw.uiType : "single",
    marks: Number(raw?.marks),
    options: Array.isArray(raw?.options)
      ? raw.options.map((o) => ({
          id: typeof o?.id === "string" ? o.id : undefined,
          text: typeof o?.text === "string" ? o.text : "",
          isCorrect: !!o?.isCorrect,
          explanation: typeof o?.explanation === "string" ? o.explanation : "",
        }))
      : [],
    possibilities: Array.isArray(raw?.possibilities) ? raw.possibilities.filter((p): p is string => typeof p === "string") : [],
  };
}

/** Create or update a question-bank entry. */
export async function saveQuestionAction(raw: QuestionInput): Promise<ActionResult<{ question: Question; usedIn: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Log in again to save." };
  if (!isCreator(user)) return { ok: false, error: "Only course creators and moderators can manage questions." };

  const input = sanitizeInput(raw);
  const fieldErrors = validateQuestionInput(input);
  if (Object.keys(fieldErrors).length) {
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "Please fix the highlighted fields.", fieldErrors };
  }

  const db = await getDb();
  const now = new Date().toISOString();

  if (input.id) {
    const existing = db.questions.find((q) => q.id === input.id);
    if (!existing) return { ok: false, error: "This question no longer exists." };
    if (!canEditQuestion(user, existing)) return { ok: false, error: "You can only edit questions you created. Duplicate it to make your own copy." };
    const next = normalizeQuestion(input, existing, existing.id);
    const saved = await mutate((d): Question | null => {
      const row = d.questions.find((q) => q.id === existing.id);
      if (!row) return null;
      Object.assign(row, next, { updatedAt: now });
      return { ...row, options: row.options.map((o) => ({ ...o })), possibilities: [...row.possibilities] };
    });
    if (!saved) return { ok: false, error: "This question no longer exists." };
    revalidateBank();
    const fresh = await getDb();
    return { ok: true, data: { question: saved, usedIn: questionUsage(fresh).get(existing.id) ?? 0 }, message: "Question updated successfully" };
  }

  const id = uid("qst");
  const question: Question = {
    id,
    ...normalizeQuestion(input, null, id),
    authorId: user.id,
    createdAt: now,
    updatedAt: now,
  };
  await mutate((d) => {
    d.questions.push(question);
  });
  revalidateBank();
  return { ok: true, data: { question, usedIn: 0 }, message: "Question created successfully" };
}

/** Copy a question into a new bank entry owned by the current user. */
export async function duplicateQuestionAction(questionId: string): Promise<ActionResult<{ question: Question }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again." };
  if (!isCreator(user)) return { ok: false, error: "Only course creators and moderators can manage questions." };
  const db = await getDb();
  const source = db.questions.find((q) => q.id === questionId);
  if (!source) return { ok: false, error: "This question no longer exists." };
  const id = uid("qst");
  const now = new Date().toISOString();
  const question: Question = {
    ...source,
    id,
    options: source.options.map((o, i) => ({ ...o, id: `${id}_o${i + 1}` })),
    possibilities: [...source.possibilities],
    authorId: user.id,
    createdAt: now,
    updatedAt: now,
  };
  await mutate((d) => {
    d.questions.push(question);
  });
  revalidateBank();
  return { ok: true, data: { question }, message: "Question duplicated" };
}

/** Delete bank questions. Questions still used by a quiz (or not yours) are skipped and reported. */
export async function deleteQuestionsAction(ids: string[]): Promise<ActionResult<{ deleted: number; failed: { id: string; error: string }[] }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again." };
  if (!isCreator(user)) return { ok: false, error: "Only course creators and moderators can manage questions." };
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: "Select at least one question." };
  const db = await getDb();
  const usage = questionUsage(db);
  const failed: { id: string; error: string }[] = [];
  const toDelete = new Set<string>();
  for (const id of Array.from(new Set(ids))) {
    const q = db.questions.find((x) => x.id === id);
    if (!q) {
      failed.push({ id, error: "not found" });
      continue;
    }
    if (!canEditQuestion(user, q)) {
      failed.push({ id, error: "you can only delete questions you created" });
      continue;
    }
    const used = usage.get(id) ?? 0;
    if (used > 0) {
      failed.push({ id, error: `still used in ${used} ${used === 1 ? "quiz" : "quizzes"}` });
      continue;
    }
    toDelete.add(id);
  }
  if (toDelete.size) {
    // Captured before the delete (the store snapshot is live and loses these rows).
    const removed = Array.from(toDelete, (id) => {
      const q = db.questions.find((x) => x.id === id);
      return { id, meta: { text: q?.text.slice(0, 120) ?? id, type: q?.type ?? "" } };
    });
    await mutate((d) => {
      d.questions = d.questions.filter((q) => !toDelete.has(q.id));
    });
    await auditEach(user, "question.delete", "question", removed, toDelete.size > 1 ? { bulk: true } : undefined);
    revalidateBank();
  }
  return { ok: true, data: { deleted: toDelete.size, failed } };
}

/** Question bank search for the quiz builder (max 100 results, excludes questions already in the quiz). */
export async function searchQuestionBankAction(opts: {
  search?: string;
  type?: UiQuestionType | "";
  exclude?: string[];
  scope?: BankScope;
}): Promise<ActionResult<QuestionBankItem[]>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again." };
  if (!isCreator(user)) return { ok: false, error: "Only course creators and moderators can use the question bank." };
  const items = await searchQuestionBank(user, {
    search: typeof opts?.search === "string" ? opts.search.slice(0, 200) : "",
    type: opts?.type ?? "",
    exclude: Array.isArray(opts?.exclude) ? opts.exclude.filter((x): x is string => typeof x === "string") : [],
    scope: opts?.scope === "open_ended" || opts?.scope === "closed" ? opts.scope : "any",
  });
  return { ok: true, data: items };
}
