import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scenarioContextManager } from "@/store/scenarioContext";
import { createDefaultCluster } from "@/utils/clusterFactory";
import { useEffectiveCluster } from "@/hooks/useEffectiveCluster";

describe("useEffectiveCluster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scenarioContextManager.clearAll();
  });

  afterEach(() => {
    scenarioContextManager.clearAll();
    vi.useRealTimers();
  });

  it("returns to the global cluster when an incident context is cleared", () => {
    const globalCluster = createDefaultCluster();
    const context = scenarioContextManager.createContext(
      "incident-test",
      globalCluster,
    );
    context.updateGPU("dgx-00", 0, { healthStatus: "Warning" });
    scenarioContextManager.setActiveContext("incident-test");

    const { result } = renderHook(() => useEffectiveCluster(globalCluster));
    expect(result.current).toBe(context.getCluster());

    act(() => {
      scenarioContextManager.setActiveContext(null);
      scenarioContextManager.deleteContext("incident-test");
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe(globalCluster);
  });
});
