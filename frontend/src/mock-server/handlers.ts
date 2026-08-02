import type { RequestHandler } from "msw";
import { getNotesHandler } from "./getNotesHandler";
import { seedHandler } from "./seedHandler";
import { getPatientsHandler } from "./patientsHandler";
import { assignReviewerHandler, regenerateHandler, } from "./bulkActionsHandler";
import { getNoteDetailHandler, } from "./getNoteDetailHandler";
import { saveNoteVersionHandler } from "./saveNoteVersionHandler";
import { transitionNoteHandler } from "./transitionNoteHandler";
import { telemetryHandler } from "./telemetryHandler";

export const handlers: RequestHandler[] = [
    getNoteDetailHandler,
    getNotesHandler,
    seedHandler,
    getPatientsHandler,
    assignReviewerHandler,
    regenerateHandler,
    saveNoteVersionHandler,
    transitionNoteHandler,
    telemetryHandler,
];