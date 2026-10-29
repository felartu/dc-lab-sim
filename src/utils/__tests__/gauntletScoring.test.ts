import { describe, expect, it } from "vitest";
import { getGauntletAttemptPercentage } from "../gauntletScoring";

describe("getGauntletAttemptPercentage", () => {
  it("uses domain counts to correct legacy percentage-valued attempts", () => {
    expect(
      getGauntletAttemptPercentage({
        score: 10,
        totalQuestions: 10,
        domainBreakdown: {
          domain1: { correct: 1, total: 3 },
          domain2: { correct: 0, total: 1 },
          domain3: { correct: 0, total: 2 },
          domain4: { correct: 0, total: 3 },
          domain5: { correct: 0, total: 1 },
        },
      }),
    ).toBe(10);
  });

  it("uses the score count when domain totals do not cover the attempt", () => {
    expect(
      getGauntletAttemptPercentage({
        score: 2,
        totalQuestions: 4,
        domainBreakdown: { domain1: { correct: 2, total: 3 } },
      }),
    ).toBe(50);
  });

  it("returns zero for attempts without a positive question count", () => {
    expect(
      getGauntletAttemptPercentage({
        score: 0,
        totalQuestions: 0,
        domainBreakdown: {},
      }),
    ).toBe(0);
  });
});
