import type {
  NoteSummary,
} from "../../../domain/noteSummary";

export interface FilterOption {
  id: string;
  displayName: string;
}

export interface NoteListResponse {
  items: NoteSummary[];

  filterOptions: {
    reviewers: FilterOption[];
    patients: FilterOption[];
  };

  cursor: {
    next: string | null;
    hasMore: boolean;
  };

  meta: {
    total: number;
    returned: number;
  };
}