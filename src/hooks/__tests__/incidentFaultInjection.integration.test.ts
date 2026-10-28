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

  it("shows the Domain 1 PSU cap on GPUs 0-3, not a 700W draw fault", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { result, unmount } = renderHook(() => useIncidentSession());

    act(() => {
      result.current.startIncident("beginner", 1);
    });

    expect(result.current.situation).toContain("PSU 1");
    const incidentContext = scenarioContextManager.getActiveContext();
    expect(incidentContext).toBeDefined();

    const targetNode = incidentContext!
      .getCluster()
      .nodes.find((node) =>
        node.gpus.slice(0, 4).every((gpu) => gpu.powerLimit === 300),
      );
    expect(targetNode).toBeDefined();
    for (const gpu of targetNode!.gpus.slice(0, 4)) {
      expect(gpu.powerLimit).toBe(300);
      expect(gpu.powerDraw).toBeLessThanOrEqual(300);
    }
    for (const gpu of targetNode!.gpus.slice(4)) {
      expect(gpu.powerLimit).not.toBe(300);
      expect(gpu.powerDraw).not.toBe(700);
    }

    const simulator = new NvidiaSmiSimulator();
    const output = simulator.execute(parse("nvidia-smi -q -d POWER"), {
      currentNode: targetNode!.id,
      currentPath: "/root",
      environment: {},
      history: [],
      cluster: incidentContext!.getCluster(),
      scenarioContext: incidentContext,
    });
    const gpu0Section = output.output
      .split("GPU 00000000")[1]
      ?.split("GPU 00000001")[0];
    expect(gpu0Section).toContain(
      "Current Power Limit               : 300.00 W",
    );
    unmount();
  });
});
