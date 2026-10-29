import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NvidiaSmiSimulator } from "@/simulators/nvidiaSmiSimulator";
import { IpmitoolSimulator } from "@/simulators/ipmitoolSimulator";
import { BasicSystemSimulator } from "@/simulators/basicSystemSimulator";
import { InfiniBandSimulator } from "@/simulators/infinibandSimulator";
import { SlurmSimulator } from "@/simulators/slurmSimulator";
import { LinuxUtilsSimulator } from "@/simulators/linuxUtilsSimulator";
import { useIncidentSession } from "@/hooks/useIncidentSession";
import { parse } from "@/utils/commandParser";
import { scenarioContextManager } from "@/store/scenarioContext";
import { useSimulationStore } from "@/store/simulationStore";
import { INCIDENT_TEMPLATES } from "@/data/incidentTemplates";

describe("live incident fault injection", () => {
  afterEach(() => {
    scenarioContextManager.clearAll();
    vi.restoreAllMocks();
  });

  const cases = [
    ["gpu-memory-xid48", 1, "beginner"],
    ["gpu-hang-xid43", 4, "intermediate"],
    ["gpu-off-bus-xid79", 5, "advanced"],
    ["nvlink-fabric-degradation", 2, "intermediate"],
    ["thermal-runaway", 5, "beginner"],
    ["ecc-accumulation-row-remap", 4, "advanced"],
    ["multi-node-job-failure", 4, "intermediate"],
    ["power-supply-stress", 1, "beginner"],
    ["infiniband-link-down", 2, "intermediate"],
    ["combined-nvlink-thermal", 5, "advanced"],
    ["driver-error-bringup", 3, "beginner"],
  ] as const;

  it.each(cases)(
    "injects the primary fault for %s",
    (id, domain, difficulty) => {
      const candidates = INCIDENT_TEMPLATES.filter(
        (template) =>
          template.domains.includes(domain) &&
          template.difficulty === difficulty,
      );
      const index = candidates.findIndex((template) => template.id === id);
      expect(index).toBeGreaterThanOrEqual(0);
      vi.spyOn(Math, "random").mockReturnValue(
        (index + 0.1) / candidates.length,
      );
      const { result, unmount } = renderHook(() => useIncidentSession());
      act(() => result.current.startIncident(difficulty, domain));
      const context = scenarioContextManager.getActiveContext()!;
      const nodeId = result.current.situation.match(/dgx-\d+/)?.[0];
      expect(nodeId).toBeDefined();
      const node = context.getNode(nodeId!)!;
      const gpu = (index: number) => node.gpus.find((g) => g.id === index)!;
      const xid = (index: number, code: number) =>
        expect(gpu(index).xidErrors.some((e) => e.code === code)).toBe(true);
      const simulator = new NvidiaSmiSimulator();
      const slurm = new SlurmSimulator();
      const slurmContext = {
        currentNode: nodeId!,
        currentPath: "/root",
        environment: {},
        history: [],
        cluster: context.getCluster(),
        scenarioContext: context,
      };
      slurm.syncFromContext(slurmContext);
      const command = (line: string) =>
        simulator.execute(parse(line), {
          currentNode: nodeId!,
          currentPath: "/root",
          environment: {},
          history: [],
          scenarioContext: context,
          cluster: context.getCluster(),
        });
      for (const diagnostic of result.current.diagnosticPath) {
        for (const hostname of diagnostic.match(/dgx-\d+/g) ?? [])
          expect(hostname).toBe(nodeId);
      }

      switch (id) {
        case "gpu-memory-xid48":
          expect(gpu(3).eccErrors.doubleBit).toBeGreaterThan(0);
          xid(3, 48);
          expect(gpu(3).utilization).toBe(0);
          expect(
            slurm.executeSqueue(parse("squeue"), slurmContext).output,
          ).toContain("training");
          expect(
            slurm.executeSqueue(parse("squeue"), slurmContext).output,
          ).toContain(nodeId);
          break;
        case "gpu-hang-xid43":
          expect(gpu(5).utilization).toBe(0);
          xid(5, 43);
          expect(
            node.gpus
              .filter((g) => g.id !== 5)
              .every((g) => g.utilization === 100),
          ).toBe(true);
          expect(command("nvidia-smi").output).toContain("python (job 1000)");
          expect(command("nvidia-smi").output).not.toContain(
            "No running processes found",
          );
          break;
        case "gpu-off-bus-xid79":
          xid(2, 79);
          expect(gpu(2).healthStatus).toBe("Critical");
          expect(gpu(2).utilization).toBe(0);
          expect(node.gpus.filter((g) => g.healthStatus === "OK")).toHaveLength(
            7,
          );
          expect(node.slurmState).toBe("drain");
          expect(command("nvidia-smi -L").output).not.toContain("GPU 2:");
          expect(
            new BasicSystemSimulator().execute(parse("dmesg"), slurmContext)
              .output,
          ).toMatch(/AER: Corrected error/);
          expect(
            new IpmitoolSimulator().execute(
              parse("ipmitool sel list"),
              slurmContext,
            ).output,
          ).toMatch(/GPU #2 PCIe.*Correctable AER error storm/);
          break;
        case "nvlink-fabric-degradation":
          for (const i of [1, 2])
            expect(gpu(i).nvlinks[2].replayErrors).toBeGreaterThan(0);
          expect(command("nvidia-smi nvlink -e").output).toContain(
            "Replay Errors: 25",
          );
          break;
        case "thermal-runaway":
          expect(
            node.gpus.every((g) => g.temperature === 95 && g.clocksSM === 600),
          ).toBe(true);
          expect(
            node.bmc.sensors.find((s) => s.name === "Inlet Temp")?.reading,
          ).toBe(42);
          break;
        case "ecc-accumulation-row-remap":
          expect(gpu(6).eccErrors.singleBit).toBe(1247);
          expect(gpu(6).eccErrors.doubleBit).toBe(0);
          xid(6, 92);
          expect(command("nvidia-smi -q -d ROW_REMAPPER").output).toContain(
            "Correctable Error                 : true",
          );
          break;
        case "multi-node-job-failure":
          xid(7, 43);
          expect(node.slurmState).toBe("drain");
          {
            const accounting = slurm.executeSacct(
              parse("sacct -j 84291 --format=JobID,NodeList,ExitCode,State"),
              slurmContext,
            );
            expect(accounting.output).toContain(
              `84291.12 | ${nodeId} | 1:0 | FAILED`,
            );
            expect(accounting.output).toContain("0:9 | FAILED");
          }
          break;
        case "power-supply-stress":
          expect(
            node.gpus
              .slice(0, 4)
              .every((g) => g.powerLimit === 300 && g.powerDraw <= 300),
          ).toBe(true);
          break;
        case "infiniband-link-down":
          expect(node.hcas[0].ports[0].state).toBe("Down");
          {
            const ib = new InfiniBandSimulator();
            const ctx = {
              currentNode: nodeId!,
              currentPath: "/root",
              environment: {},
              history: [],
              cluster: context.getCluster(),
              scenarioContext: context,
            };
            const diagnosis = ib.executeIbdiagnet(parse("ibdiagnet"), ctx);
            expect(diagnosis.output).toContain("Down (LinkDown)");
            expect(diagnosis.output).not.toContain("No errors found");
            expect(
              ib.executeIblinkinfo(parse("iblinkinfo"), ctx).output,
            ).toContain(" Down ");
            const linux = new LinuxUtilsSimulator();
            for (const line of [
              "ip addr show ib0",
              "ip addr",
              "ip link show ib0",
              "ip link",
            ]) {
              expect(linux.execute(parse(line), ctx).output).toMatch(
                /ib0: <NO-CARRIER,[^>]+>[^\n]*state DOWN/,
              );
            }
            expect(linux.execute(parse("ip route"), ctx).output).toMatch(
              /dev ib0[^\n]*linkdown/,
            );
            const otherNode = context
              .getCluster()
              .nodes.find((candidate) => candidate.id !== nodeId)!;
            expect(
              linux.execute(parse("ip addr show ib0"), {
                ...ctx,
                currentNode: otherNode.id,
              }).output,
            ).toMatch(/ib0: <[^>]*LOWER_UP[^>]*>[^\n]*state UP/);
          }
          break;
        case "combined-nvlink-thermal":
          for (const i of [3, 4])
            expect(gpu(i).nvlinks[2].replayErrors).toBeGreaterThan(0);
          for (const i of [6, 7]) expect(gpu(i).temperature).toBe(95);
          expect(node.gpus.map((g) => g.utilization)).toEqual([
            30, 45, 65, 90, 40, 75, 55, 35,
          ]);
          expect(
            node.bmc.sensors.find((s) => s.name === "Inlet Temp")?.reading,
          ).toBe(39);
          break;
        case "driver-error-bringup":
          expect(context.getServiceState(nodeId!, "nvidia-driver")).toBe(
            "inactive",
          );
          expect(command("nvidia-smi").exitCode).not.toBe(0);
          expect(node.gpus.every((gpu) => gpu.healthStatus === "Unknown")).toBe(
            true,
          );
          {
            const basic = new BasicSystemSimulator();
            const ctx = {
              currentNode: nodeId!,
              currentPath: "/root",
              environment: {},
              history: [],
              cluster: context.getCluster(),
              scenarioContext: context,
            };
            expect(basic.execute(parse("lsmod"), ctx).output).not.toMatch(
              /nvidia/i,
            );
            expect(basic.execute(parse("uname -r"), ctx).output).toContain(
              "5.15.0-97-generic",
            );
            expect(basic.execute(parse("dkms status"), ctx).output).toContain(
              "build failed",
            );
            expect(
              basic.execute(parse("dmesg | grep -i nvidia"), ctx).output,
            ).toContain("DKMS build failed");
          }
          break;
      }
      act(() => {
        result.current.recordCommand("nvidia-smi");
      });
      expect(result.current.commandCount).toBe(1);
      const correctRootCause = INCIDENT_TEMPLATES.find(
        (template) => template.id === id,
      )!.correctRootCause.replace(/dgx-\d+/g, nodeId!);
      expect(result.current.rootCauseOptions).toContain(correctRootCause);
      const diagnosticPath = [...result.current.diagnosticPath];
      expect(diagnosticPath.length).toBeGreaterThan(0);
      act(() => result.current.submitDiagnosis(correctRootCause));
      expect(result.current.incidentState).toBe("review");
      expect(result.current.reviewData?.correctDiagnosis).toBe(true);
      expect(result.current.diagnosticPath).toEqual(diagnosticPath);
      expect(scenarioContextManager.getActiveContext()).toBeUndefined();
      unmount();
    },
  );

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
    expect(gpu0Section).toContain(
      "Default Power Limit               : 400.00 W",
    );
    expect(gpu0Section).toContain(
      "Max Power Limit                   : 400.00 W",
    );
    const fullOutput = simulator.execute(parse("nvidia-smi -i 0 -q"), {
      currentNode: targetNode!.id,
      currentPath: "/root",
      environment: {},
      history: [],
      cluster: incidentContext!.getCluster(),
      scenarioContext: incidentContext,
    });
    expect(fullOutput.output).toMatch(/Default Power Limit\s+: 400\.00 W/);
    expect(fullOutput.output).toMatch(/Max Power Limit\s+: 400\.00 W/);
    const ipmi = new IpmitoolSimulator();
    const commandContext = {
      currentNode: targetNode!.id,
      currentPath: "/root",
      environment: {},
      history: [],
      cluster: incidentContext!.getCluster(),
      scenarioContext: incidentContext,
    };
    const sensors = ipmi.execute(parse("ipmitool sensor"), commandContext);
    expect(sensors.output).toMatch(
      /PSU1 Power\s*\|\s*2850\.000\s*\|\s*W\s*\|\s*nc/,
    );
    expect(sensors.output).toContain("2700.000");
    expect(sensors.output).toContain("3000.000");
    const sdr = ipmi.execute(parse("ipmitool sdr list"), commandContext);
    expect(sdr.output).toMatch(/PSU1 Power\s*\|\s*2850\.00 W\s*\| Warning/);
    expect(
      ipmi.execute(parse("ipmitool sel list"), commandContext).output,
    ).toMatch(/PSU1 Power.*Warning.*2850 W/);
    const otherNode = incidentContext!
      .getCluster()
      .nodes.find((node) => node.id !== targetNode!.id)!;
    expect(
      otherNode.bmc.sensors.find((sensor) => sensor.name === "PSU1 Power")
        ?.reading,
    ).toBe(850);
    expect(
      useSimulationStore
        .getState()
        .cluster.nodes.find((node) => node.id === targetNode!.id)!
        .bmc.sensors.find((sensor) => sensor.name === "PSU1 Power")?.reading,
    ).toBe(850);
    unmount();
  });
});
