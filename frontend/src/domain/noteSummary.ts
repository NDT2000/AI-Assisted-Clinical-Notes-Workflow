import type { NoteStatus } from "./noteAttributes";

// Basic template for a summary of a note, used in lists and overviews.
export interface NoteSummary {
  id: string;

  patient: {
    id: string;
    displayName: string;
  };

  status: NoteStatus;

  currentVersion: {
    id: string;
    revision: number;
  };

  assignedReviewer: {
    id: string;
    displayName: string;
  } | null;

  contentPreview: string;

  createdAt: string;
  updatedAt: string;
}