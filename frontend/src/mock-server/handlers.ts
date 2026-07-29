import type { RequestHandler } from "msw";
import { getNotesHandler } from "./getNotesHandler";

export const handlers: RequestHandler[] = [
    getNotesHandler,
];