import type { NoteStatus } from "./noteAttributes";

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

  createdAt: string;
  updatedAt: string;
}