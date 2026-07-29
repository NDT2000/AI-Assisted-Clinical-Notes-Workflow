import type { RequestHandler } from "msw";
import { getNotesHandler } from "./getNotesHandler";
import { seedHandler } from "./seedHandler";
import { getPatientsHandler } from "./patientsHandler";
import {
  assignReviewerHandler,
  regenerateHandler,
} from "./bulkActionsHandler";

export const handlers: RequestHandler[] = [
    getNotesHandler,
    seedHandler,
    getPatientsHandler,
    assignReviewerHandler,
    regenerateHandler,
];