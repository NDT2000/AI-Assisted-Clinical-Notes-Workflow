import type { NoteSummary } from "../../../domain/noteSummary";

export interface NoteListResponse {
  items: NoteSummary[];

  cursor: {
    next: string | null;
    hasMore: boolean;
  };

  meta: {
    total: number;
    returned: number;
  };
}