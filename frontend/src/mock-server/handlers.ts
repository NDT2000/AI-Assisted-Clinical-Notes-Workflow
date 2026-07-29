import type { RequestHandler } from "msw";
import { getNotesHandler } from "./getNotesHandler";
import { seedHandler } from "./seedHandler";

export const handlers: RequestHandler[] = [
    getNotesHandler,
    seedHandler,
];