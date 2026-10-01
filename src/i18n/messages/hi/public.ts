import type en from "../en/public";
import type { Translation } from "../../types";

/** Translation of `../en/public.ts`. Missing keys fall back to English. */
const publicMessages: Translation<typeof en> = {};

export default publicMessages;
