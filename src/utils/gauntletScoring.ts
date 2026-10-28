import type { GauntletAttempt } from "@/store/learningStore";

/**
 * Return the percentage represented by a Gauntlet attempt.
 *
 * Older builds stored a percentage in `score`, while the history and readiness
 * views treated it as a raw scenario count. The domain breakdown has always
 * retained the raw counts, so prefer it when it covers the whole attempt.
 */
export function getGauntletAttemptPercentage(
  attempt: Pick<GauntletAttempt, "score" | "totalQuestions" | "domainBreakdown">,
): number {
  if (attempt.totalQuestions <= 0) return 0;

  const domains = Object.values(attempt.domainBreakdown ?? {});
  const breakdownTotal = domains.reduce((sum, domain) => sum + domain.total, 0);

  if (breakdownTotal === attempt.totalQuestions) {
    const completed = domains.reduce((sum, domain) => sum + domain.correct, 0);
    return Math.round((completed / attempt.totalQuestions) * 100);
  }

  const completed = Math.max(0, Math.min(attempt.score, attempt.totalQuestions));
  return Math.round((completed / attempt.totalQuestions) * 100);
}
