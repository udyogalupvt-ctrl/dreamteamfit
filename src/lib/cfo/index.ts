/**
 * The pure CFO engine. The server (src/server/cfo*.ts) and the page import only from here.
 * Everything in this folder runs unchanged under `node --test` (Node 22 type stripping).
 */
export { reportWindow } from "./dates.ts";
export { computeCfo } from "./numbers.ts";
export {
  briefPrivacyCheck,
  briefSystemPrompt,
  buildBriefInput,
  verifyBriefNumbers,
} from "./brief.ts";
export * from "./money.ts";
