import { describe, it, expect, beforeEach, vi } from "vitest";
import { MellanoxSimulator } from "../mellanoxSimulator";
import { parse } from "@/utils/commandParser";
import type { CommandContext } from "@/types/commands";
import { useSimulationStore } from "@/store/simulationStore";

vi.mock("@/store/simulationStore");

function makeTestPort(linkWidth: 1 | 2 | 4) {
  return {
    portNumber: 1,
    state: "Active" as const,
    physicalState: "LinkUp" as const,
    rate: 200 as const,
    linkWidth,
    lid: 101,
    guid: "0x000000000001",
    linkLayer: "InfiniBand" as const,
    errors: {
      symbolErrors: 0,
      linkDowned: 0,
      portRcvErrors: 0,
      portXmitDiscards: 0,
      portXmitWait: 0,
    },
  };
}

function makeTestHca(id: number, linkWidth: 1 | 2 | 4) {
  return {
    id,
    devicePath: `/dev/mst/mt4129_pciconf${id}`,
    caType: "ConnectX-7 HCA",
    firmwareVersion: "28.39.1002",
    ports: [makeTestPort(linkWidth)],
  };
}

describe("MellanoxSimulator", () => {
  let simulator: MellanoxSimulator;
  let context: CommandContext;

  beforeEach(() => {
    simulator = new MellanoxSimulator();
    context = {
      currentNode: "dgx-00",
      currentPath: "/root",
      environment: {},
      history: [],
    };

    vi.mocked(useSimulationStore.getState).mockReturnValue({
      cluster: {
        nodes: [
          {
            id: "dgx-00",
            dpus: [
              {
                id: 0,
                pciAddress: "0000:a0:00.0",
                devicePath: "/dev/mst/mt41692_pciconf0",
                firmwareVersion: "24.35.2000",
                mode: {
                  mode: "DPU",
                  internalCpuModel: 1,
                  description: "DPU mode - Arm cores own NIC resources",
                },
                armOS: "Ubuntu 22.04",
                ovsConfigured: true,
                rshimAvailable: true,
              },
            ],
            hcas: [
              {
                id: 0,
                devicePath: "/dev/mst/mt4129_pciconf0",
                caType: "ConnectX-7 HCA",
                firmwareVersion: "28.39.1002",
                ports: [],
              },
            ],
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  describe("mlxconfig -d <device> q", () => {
    it("resolves an HCA by its exact device path, not a DPU with a coincidentally matching digit id", () => {
      const result = simulator.execute(
        parse("mlxconfig -d /dev/mst/mt4129_pciconf0 q"),
        context,
      );

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Device type:    ConnectX");
      expect(result.output).toContain(
        "Device:         /dev/mst/mt4129_pciconf0",
      );
    });

    it("resolves a DPU by its exact device path", () => {
      const result = simulator.execute(
        parse("mlxconfig -d /dev/mst/mt41692_pciconf0 q"),
        context,
      );

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Device type:    BlueField2");
      expect(result.output).toContain(
        "Device:         /dev/mst/mt41692_pciconf0",
      );
    });

    it("errors when the device path matches neither a DPU nor an HCA", () => {
      const result = simulator.execute(
        parse("mlxconfig -d /dev/mst/mt9999_pciconf9 q"),
        context,
      );

      expect(result.exitCode).toBe(2);
      expect(result.output).toContain("Device not found");
    });
  });

  it("shows degraded lane diagnostics in mlxlink and mlxcables output", () => {
    vi.mocked(useSimulationStore.getState).mockReturnValue({
      cluster: {
        nodes: [
          {
            id: "dgx-00",
            dpus: [],
            hcas: [makeTestHca(0, 1), makeTestHca(1, 1)],
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const eyeResult = simulator.execute(
      parse("mlxlink -d mlx5_0 -p 1 --show_eye"),
      context,
    );
    expect(eyeResult.exitCode).toBe(0);
    expect(eyeResult.output).toContain("Lane 1:");
    expect(eyeResult.output).toContain("Eye Height: 20 mV (Critical)");
    expect(eyeResult.output).toContain("Only 1 of 4 lanes trained");

    expect(simulator.execute(parse("mst start"), context).exitCode).toBe(0);
    const cableResult = simulator.execute(parse("mlxcables"), context);
    expect(cableResult.exitCode).toBe(0);
    expect(cableResult.output).toContain("QSFP-DD Optical Transceiver (Fiber)");
    expect(cableResult.output).toContain("Temperature:             68°C (Warning)");
    expect(cableResult.output).toContain("Bit Error Rate:          High (Warning)");
    expect(cableResult.output.match(/Status:\s+.*Warning/g)).toHaveLength(2);
  });
});
