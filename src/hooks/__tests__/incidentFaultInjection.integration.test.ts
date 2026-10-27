import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NvidiaSmiSimulator } from "@/simulators/nvidiaSmiSimulator";
import { useIncidentSession } from "@/hooks/useIncidentSession";
import { parse } from "@/utils/commandParser";
import { scenarioContextManager } from "@/store/scenarioContext";

describe("live incident fault injection", () => {
  afterEach(() => {
    scenarioContextManager.clearAll();
    vi.restoreAllMocks();
  });

  it("shows the Domain 1 XID 48 ECC fault in nvidia-smi output", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { result, unmount } = renderHook(() => useIncidentSession());

    act(() => {
      result.current.startIncident("beginner", 1);
    });

    const incidentContext = scenarioContextManager.getActiveContext();
    expect(incidentContext).toBeDefined();

    const terminalContext = {
      currentNode: "dgx-00",
      currentPath: "/root",
      environment: {},
      history: [],
      cluster: incidentContext!.getCluster(),
      scenarioContext: incidentContext,
    };
    const simulator = new NvidiaSmiSimulator();
    const output = simulator.execute(
      parse("nvidia-smi -q -d ECC"),
      terminalContext,
    );

    expect(output.exitCode).toBe(0);
    const gpu3Section = output.output
      .split("GPU 00000003")[1]
      ?.split("GPU 00000004")[0];
    expect(gpu3Section).toContain("DRAM Uncorrectable            : 1");
    unmount();
  });
});
