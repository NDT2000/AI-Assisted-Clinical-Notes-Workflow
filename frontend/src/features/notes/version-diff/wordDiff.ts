import type { SoapContent, } from "../../../domain/noteAttributes";

export type WordDiffSegmentType =
  | "unchanged"
  | "added"
  | "removed";

export interface WordDiffSegment {
  type: WordDiffSegmentType;
  value: string;
}

export const SOAP_VERSION_DIFF_SECTION_KEYS = [
  "subjective",
  "objective",
  "assessment",
  "plan",
] as const;

export type SoapVersionDiffSectionKey =
  (typeof SOAP_VERSION_DIFF_SECTION_KEYS)[number];

export type SoapVersionDiff = Record<
  SoapVersionDiffSectionKey,
  WordDiffSegment[]
>;

function tokenize(
  value: string,
): string[] {
  return value.match(/\s+|[^\s]+/g) ?? [];
}

function appendSegment(
  segments: WordDiffSegment[],
  type: WordDiffSegmentType,
  value: string,
): void {
  if (value.length === 0) {
    return;
  }

  const lastSegment =
    segments[segments.length - 1];

  if (lastSegment?.type === type) {
    lastSegment.value += value;
    return;
  }

  segments.push({
    type,
    value,
  });
}

export function diffWords(
  previousValue: string,
  nextValue: string,
): WordDiffSegment[] {
  const previousTokens =
    tokenize(previousValue);

  const nextTokens =
    tokenize(nextValue);

  const longestCommonSubsequence =
    Array.from(
      {
        length:
          previousTokens.length + 1,
      },
      () =>
        Array<number>(
          nextTokens.length + 1,
        ).fill(0),
    );

  for (
    let previousIndex =
      previousTokens.length - 1;
    previousIndex >= 0;
    previousIndex -= 1
  ) {
    for (
      let nextIndex =
        nextTokens.length - 1;
      nextIndex >= 0;
      nextIndex -= 1
    ) {
      if (
        previousTokens[
          previousIndex
        ] === nextTokens[nextIndex]
      ) {
        longestCommonSubsequence[
          previousIndex
        ][nextIndex] =
          longestCommonSubsequence[
            previousIndex + 1
          ][nextIndex + 1] + 1;
      } else {
        longestCommonSubsequence[
          previousIndex
        ][nextIndex] = Math.max(
          longestCommonSubsequence[
            previousIndex + 1
          ][nextIndex],
          longestCommonSubsequence[
            previousIndex
          ][nextIndex + 1],
        );
      }
    }
  }

  const segments: WordDiffSegment[] =
    [];

  let previousIndex = 0;
  let nextIndex = 0;

  while (
    previousIndex <
      previousTokens.length &&
    nextIndex < nextTokens.length
  ) {
    const previousToken =
      previousTokens[previousIndex];

    const nextToken =
      nextTokens[nextIndex];

    if (
      previousToken === nextToken
    ) {
      appendSegment(
        segments,
        "unchanged",
        previousToken,
      );

      previousIndex += 1;
      nextIndex += 1;
      continue;
    }

    const removeScore =
      longestCommonSubsequence[
        previousIndex + 1
      ][nextIndex];

    const addScore =
      longestCommonSubsequence[
        previousIndex
      ][nextIndex + 1];

    if (removeScore >= addScore) {
      appendSegment(
        segments,
        "removed",
        previousToken,
      );

      previousIndex += 1;
    } else {
      appendSegment(
        segments,
        "added",
        nextToken,
      );

      nextIndex += 1;
    }
  }

  while (
    previousIndex <
    previousTokens.length
  ) {
    appendSegment(
      segments,
      "removed",
      previousTokens[previousIndex],
    );

    previousIndex += 1;
  }

  while (
    nextIndex < nextTokens.length
  ) {
    appendSegment(
      segments,
      "added",
      nextTokens[nextIndex],
    );

    nextIndex += 1;
  }

  return segments;
}

export function compareSoapVersions(
  previousContent: SoapContent,
  nextContent: SoapContent,
): SoapVersionDiff {
  return {
    subjective: diffWords(
      previousContent.subjective,
      nextContent.subjective,
    ),

    objective: diffWords(
      previousContent.objective,
      nextContent.objective,
    ),

    assessment: diffWords(
      previousContent.assessment,
      nextContent.assessment,
    ),

    plan: diffWords(
      previousContent.plan,
      nextContent.plan,
    ),
  };
}