import type { RequestHandler } from "msw";
import { getNotesHandler } from "./getNotesHandler";
import { seedHandler } from "./seedHandler";
import { getPatientsHandler } from "./patientsHandler";
import { assignReviewerHandler, regenerateHandler, } from "./bulkActionsHandler";
import { getNoteDetailHandler, } from "./getNoteDetailHandler";

export const handlers: RequestHandler[] = [
  getNoteDetailHandler,
    getNotesHandler,
    seedHandler,
    getPatientsHandler,
    assignReviewerHandler,
    regenerateHandler,
];