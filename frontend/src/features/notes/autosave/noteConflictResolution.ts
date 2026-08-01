import type { SoapContent, } from "../../../domain/noteAttributes";

export const SOAP_CONFLICT_SECTION_KEYS = [
  "subjective",
  "objective",
  "assessment",
  "plan",
] as const;

export type SoapConflictSectionKey =
  (typeof SOAP_CONFLICT_SECTION_KEYS)[number];

export type SoapSectionComparisonStatus =
  | "unchanged"
  | "local-only"
  | "server-only"
  | "same-change"
  | "conflict";

export interface SoapSectionComparison {
  status: SoapSectionComparisonStatus;
  ancestor: string;
  local: string;
  server: string;
  automaticValue: string | null;
}

export type SoapConflictComparison = Record<
  SoapConflictSectionKey,
  SoapSectionComparison
>;

export type SoapConflictResolution =
  | {
      source: "local";
    }
  | {
      source: "server";
    }
  | {
      source: "manual";
      value: string;
    };

export type SoapConflictResolutions =
  Partial<
    Record<
      SoapConflictSectionKey,
      SoapConflictResolution
    >
  >;

function compareSection(
  ancestor: string,
  local: string,
  server: string,
): SoapSectionComparison {
  const localChanged =
    local !== ancestor;

  const serverChanged =
    server !== ancestor;

  if (
    !localChanged &&
    !serverChanged
  ) {
    return {
      status: "unchanged",
      ancestor,
      local,
      server,
      automaticValue: ancestor,
    };
  }

  if (
    localChanged &&
    !serverChanged
  ) {
    return {
      status: "local-only",
      ancestor,
      local,
      server,
      automaticValue: local,
    };
  }

  if (
    !localChanged &&
    serverChanged
  ) {
    return {
      status: "server-only",
      ancestor,
      local,
      server,
      automaticValue: server,
    };
  }

  if (local === server) {
    return {
      status: "same-change",
      ancestor,
      local,
      server,
      automaticValue: local,
    };
  }

  return {
    status: "conflict",
    ancestor,
    local,
    server,
    automaticValue: null,
  };
}

export function compareSoapConflict(
  ancestor: SoapContent,
  local: SoapContent,
  server: SoapContent,
): SoapConflictComparison {
  return {
    subjective: compareSection(
      ancestor.subjective,
      local.subjective,
      server.subjective,
    ),

    objective: compareSection(
      ancestor.objective,
      local.objective,
      server.objective,
    ),

    assessment: compareSection(
      ancestor.assessment,
      local.assessment,
      server.assessment,
    ),

    plan: compareSection(
      ancestor.plan,
      local.plan,
      server.plan,
    ),
  };
}

function resolveSection(
  comparison: SoapSectionComparison,
  resolution:
    | SoapConflictResolution
    | undefined,
): string | null {
  if (
    comparison.automaticValue !== null
  ) {
    return comparison.automaticValue;
  }

  if (!resolution) {
    return null;
  }

  switch (resolution.source) {
    case "local":
      return comparison.local;

    case "server":
      return comparison.server;

    case "manual":
      return resolution.value;
  }
}

export function resolveSoapConflict(
  comparison: SoapConflictComparison,
  resolutions: SoapConflictResolutions,
): SoapContent | null {
  const subjective = resolveSection(
    comparison.subjective,
    resolutions.subjective,
  );

  const objective = resolveSection(
    comparison.objective,
    resolutions.objective,
  );

  const assessment = resolveSection(
    comparison.assessment,
    resolutions.assessment,
  );

  const plan = resolveSection(
    comparison.plan,
    resolutions.plan,
  );

  if (
    subjective === null ||
    objective === null ||
    assessment === null ||
    plan === null
  ) {
    return null;
  }

  return {
    subjective,
    objective,
    assessment,
    plan,
  };
}