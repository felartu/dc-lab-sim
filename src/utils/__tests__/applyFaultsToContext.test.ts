import { describe, it, expect, vi } from "vitest";
import { applyFaultsToContext } from "../scenarioLoader";
import { ScenarioContext } from "@/store/scenarioContext";
import { InfiniBandSimulator } from "@/simulators/infinibandSimulator";
import { parse } from "@/utils/commandParser";
import type { FaultInjectionConfig } from "@/types/scenarios";
import type { ClusterConfig } from "@/types/hardware";

// Mock the simulation store (ScenarioContext imports it)
vi.mock("@/store/simulationStore", () => ({
  useSimulationStore: {
    getState: () => ({
      cluster: {
        name: "test",
        nodes: [],
        fabricTopology: "FatTree",
        bcmHA: { enabled: false, primary: "", secondary: "", state: "Active" },
        slurmConfig: { controlMachine: "", partitions: [] },
      },
    }),
  },
}));

function createTestCluster(): ClusterConfig {
  return {
    name: "test-cluster",
    nodes: [
      {
        id: "dgx-00",
        hostname: "dgx-00",
        systemType: "DGX-H100",
        gpus: [
          {
            id: 0,
            uuid: "GPU-0",
            name: "H100-SXM",
            type: "H100-SXM",
            pciAddress: "00:00.0",
            temperature: 45,
            powerDraw: 300,
            powerLimit: 700,
            memoryTotal: 81920,
            memoryUsed: 0,
            utilization: 50,
            clocksSM: 1980,
            clocksMem: 1593,
            eccEnabled: true,
            eccErrors: {
              singleBit: 0,
              doubleBit: 0,
              aggregated: { singleBit: 0, doubleBit: 0 },
            },
            migMode: false,
            migInstances: [],
            nvlinks: [],
            healthStatus: "OK",
            xidErrors: [],
            persistenceMode: true,
          },
          {
            id: 1,
            uuid: "GPU-1",
            name: "H100-SXM",
            type: "H100-SXM",
            pciAddress: "00:01.0",
            temperature: 45,
            powerDraw: 300,
            powerLimit: 700,
            memoryTotal: 81920,
            memoryUsed: 0,
            utilization: 50,
            clocksSM: 1980,
            clocksMem: 1593,
            eccEnabled: true,
            eccErrors: {
              singleBit: 0,
              doubleBit: 0,
              aggregated: { singleBit: 0, doubleBit: 0 },
            },
            migMode: false,
            migInstances: [],
            nvlinks: [],
            healthStatus: "OK",
            xidErrors: [],
            persistenceMode: true,
          },
        ],
        dpus: [],
        hcas: [],
        bmc: {
          ipAddress: "10.0.0.1",
          macAddress: "00:11:22:33:44:55",
          firmwareVersion: "1.0",
          manufacturer: "NVIDIA",
          sensors: [],
          powerState: "On",
        },
        cpuModel: "AMD EPYC 7742",
        cpuCount: 2,
        ramTotal: 1024,
        ramUsed: 256,
        osVersion: "Ubuntu 22.04",
        kernelVersion: "5.15.0",
        nvidiaDriverVersion: "535.129.03",
        cudaVersion: "12.2",
        healthStatus: "OK",
        slurmState: "idle",
      },
    ],
    fabricTopology: "FatTree",
    bcmHA: {
      enabled: true,
      primary: "bcm-01",
      secondary: "bcm-02",
      state: "Active",
    },
    slurmConfig: {
      controlMachine: "slurm-ctrl",
      partitions: ["gpu"],
    },
  };
}

describe("applyFaultsToContext", () => {
  it("injects an InfiniBand link failure visible through ibstat", () => {
    const cluster = createTestCluster();
    cluster.nodes[0].hcas = [
      {
        id: 0,
        devicePath: "/dev/mst/mt4123_pciconf0",
        caType: "ConnectX-6 HCA",
        firmwareVersion: "20.35.1012",
        ports: [
          {
            portNumber: 1,
            state: "Active",
            physicalState: "LinkUp",
            rate: 200,
            lid: 101,
            guid: "0x000000000001",
            linkLayer: "InfiniBand",
            errors: {
              symbolErrors: 0,
              linkDowned: 0,
              portRcvErrors: 0,
              portXmitDiscards: 0,
              portXmitWait: 0,
            },
          },
        ],
      },
    ];
    const context = new ScenarioContext("test", cluster);

    applyFaultsToContext(
      [{ nodeId: "dgx-00", type: "ib-link-down", severity: "critical" }],
      context,
    );

    const port = context.getNode("dgx-00")?.hcas[0].ports[0];
    expect(port?.state).toBe("Down");
    expect(port?.physicalState).toBe("LinkDown");
    expect(port?.errors.linkDowned).toBe(1);
    expect(context.getGPU("dgx-00", 0)?.healthStatus).toBe("OK");

    const simulator = new InfiniBandSimulator();
    const result = simulator.executeIbstat(parse("ibstat"), {
      currentNode: "dgx-00",
      currentPath: "/root",
      environment: {},
      history: [],
      scenarioContext: context,
    });
    expect(result.output).toContain("State: Down");
    expect(result.output).toContain("Physical state: LinkDown");
    expect(context.getMutationCount()).toBe(1);
  });

  it("falls back to the node's first HCA and port when IDs are not zero-based", () => {
    const cluster = createTestCluster();
    cluster.nodes[0].hcas = [
      {
        id: 4,
        devicePath: "/dev/mst/mt4123_pciconf4",
        caType: "ConnectX-6 HCA",
        firmwareVersion: "20.35.1012",
        ports: [
          {
            portNumber: 2,
            state: "Active",
            physicalState: "LinkUp",
            rate: 200,
            lid: 102,
            guid: "0x000000000002",
            linkLayer: "InfiniBand",
            errors: {
              symbolErrors: 0,
              linkDowned: 0,
              portRcvErrors: 0,
              portXmitDiscards: 0,
              portXmitWait: 0,
            },
          },
        ],
      },
    ];
    const context = new ScenarioContext("test-nonzero-ids", cluster);

    applyFaultsToContext(
      [{ nodeId: "dgx-00", type: "ib-link-down", severity: "critical" }],
      context,
    );

    const port = context.getNode("dgx-00")?.hcas[0].ports[0];
    expect(port?.state).toBe("Down");
    expect(port?.physicalState).toBe("LinkDown");
    expect(port?.errors.linkDowned).toBe(1);
  });

  it("applies xid-error fault to context", () => {
    const cluster = createTestCluster();
    const context = new ScenarioContext("test", cluster);

    const faults: FaultInjectionConfig[] = [
      {
        nodeId: "dgx-00",
        gpuId: 0,
        type: "xid-error",
        severity: "critical",
        parameters: { xid: 79 },
      },
    ];

    applyFaultsToContext(faults, context);

    const gpu = context.getGPU("dgx-00", 0);
    expect(gpu?.xidErrors).toHaveLength(1);
    expect(gpu?.xidErrors[0].code).toBe(79);
    expect(gpu?.healthStatus).toBe("Critical");
    expect(gpu?.utilization).toBe(0);
    expect(context.getMutationCount()).toBe(2);
  });

  it("applies thermal fault to context", () => {
    const cluster = createTestCluster();
    const context = new ScenarioContext("test", cluster);

    const faults: FaultInjectionConfig[] = [
      {
        nodeId: "dgx-00",
        gpuId: 1,
        type: "thermal",
        severity: "warning",
        parameters: { targetTemp: 92 },
      },
    ];

    applyFaultsToContext(faults, context);

    const gpu = context.getGPU("dgx-00", 1);
    expect(gpu?.temperature).toBe(92);
  });

  it("applies a power cap without leaving draw above the limit", () => {
    const cluster = createTestCluster();
    cluster.nodes[0].gpus[0].powerDraw = 650;
    const context = new ScenarioContext("test", cluster);

    applyFaultsToContext(
      [
        {
          nodeId: "dgx-00",
          gpuId: 0,
          type: "power",
          severity: "warning",
          parameters: { powerLimit: 300 },
        },
      ],
      context,
    );

    expect(context.getGPU("dgx-00", 0)?.powerLimit).toBe(300);
    expect(context.getGPU("dgx-00", 0)?.powerDraw).toBe(300);
    expect(context.getGPU("dgx-00", 1)?.powerLimit).toBe(700);
  });

  it("applies memory-full fault to context", () => {
    const cluster = createTestCluster();
    const context = new ScenarioContext("test", cluster);

    const faults: FaultInjectionConfig[] = [
      { nodeId: "dgx-00", gpuId: 0, type: "memory-full", severity: "critical" },
    ];

    applyFaultsToContext(faults, context);

    const gpu = context.getGPU("dgx-00", 0);
    expect(gpu?.memoryUsed).toBe(79000);
  });

  it("applies ecc-error fault to context", () => {
    const cluster = createTestCluster();
    const context = new ScenarioContext("test", cluster);

    const faults: FaultInjectionConfig[] = [
      {
        nodeId: "dgx-00",
        gpuId: 0,
        type: "ecc-error",
        severity: "critical",
        parameters: { singleBit: 50, doubleBit: 3 },
      },
    ];

    applyFaultsToContext(faults, context);

    const gpu = context.getGPU("dgx-00", 0);
    expect(gpu?.eccErrors.singleBit).toBe(50);
    expect(gpu?.eccErrors.doubleBit).toBe(3);
  });

  it("applies nvlink-failure fault to context", () => {
    const cluster = createTestCluster();
    const context = new ScenarioContext("test", cluster);

    const faults: FaultInjectionConfig[] = [
      {
        nodeId: "dgx-00",
        gpuId: 0,
        type: "nvlink-failure",
        severity: "warning",
      },
    ];

    applyFaultsToContext(faults, context);

    const gpu = context.getGPU("dgx-00", 0);
    expect(gpu?.healthStatus).toBe("Warning");
  });

  it("applies gpu-hang fault to context", () => {
    const cluster = createTestCluster();
    const context = new ScenarioContext("test", cluster);

    const faults: FaultInjectionConfig[] = [
      { nodeId: "dgx-00", gpuId: 0, type: "gpu-hang", severity: "critical" },
    ];

    applyFaultsToContext(faults, context);

    const gpu = context.getGPU("dgx-00", 0);
    expect(gpu?.utilization).toBe(0);
    expect(gpu?.healthStatus).toBe("Critical");
  });

  it("does not mutate global store", () => {
    const cluster = createTestCluster();
    const context = new ScenarioContext("test", cluster);
    const originalCluster = createTestCluster(); // Fresh copy for comparison

    const faults: FaultInjectionConfig[] = [
      {
        nodeId: "dgx-00",
        gpuId: 0,
        type: "thermal",
        severity: "warning",
        parameters: { targetTemp: 95 },
      },
      {
        nodeId: "dgx-00",
        gpuId: 1,
        type: "xid-error",
        severity: "critical",
        parameters: { xid: 43 },
      },
    ];

    applyFaultsToContext(faults, context);

    // Context should be mutated
    expect(context.getGPU("dgx-00", 0)?.temperature).toBe(95);
    expect(context.getGPU("dgx-00", 1)?.xidErrors).toHaveLength(1);

    // Original cluster should be unchanged (deep clone in ScenarioContext)
    expect(originalCluster.nodes[0].gpus[0].temperature).toBe(45);
    expect(originalCluster.nodes[0].gpus[1].xidErrors).toHaveLength(0);
  });

  it("handles empty faults array as no-op", () => {
    const cluster = createTestCluster();
    const context = new ScenarioContext("test", cluster);

    applyFaultsToContext([], context);

    expect(context.getMutationCount()).toBe(0);
  });

  it("applies multiple faults across different GPUs", () => {
    const cluster = createTestCluster();
    const context = new ScenarioContext("test", cluster);

    const faults: FaultInjectionConfig[] = [
      {
        nodeId: "dgx-00",
        gpuId: 0,
        type: "thermal",
        severity: "warning",
        parameters: { targetTemp: 92 },
      },
      { nodeId: "dgx-00", gpuId: 1, type: "memory-full", severity: "critical" },
    ];

    applyFaultsToContext(faults, context);

    expect(context.getGPU("dgx-00", 0)?.temperature).toBe(92);
    expect(context.getGPU("dgx-00", 1)?.memoryUsed).toBe(79000);
    expect(context.getMutationCount()).toBe(2);
  });
});
