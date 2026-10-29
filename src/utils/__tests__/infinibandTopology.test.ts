import { describe, expect, it } from "vitest";
import { createDefaultCluster } from "@/utils/clusterFactory";
import {
  getHostRailLinkStatus,
  getInfiniBandLinkCounts,
} from "@/utils/infinibandTopology";

describe("InfiniBand topology link state", () => {
  it("counts and maps an incident's failed HCA rail while other rails stay active", () => {
    const cluster = createDefaultCluster();
    const target = cluster.nodes.find((node) => node.id === "dgx-06");
    expect(target).toBeDefined();

    const failedPort = target!.hcas[0].ports[0];
    failedPort.state = "Down";
    failedPort.physicalState = "LinkDown";

    expect(getHostRailLinkStatus(target, 0)).toBe("down");
    expect(getHostRailLinkStatus(target, 1)).toBe("active");
    expect(getInfiniBandLinkCounts(cluster)).toEqual({ active: 63, total: 64 });
  });

  it("treats an active logical state with a physical link down as a failed link", () => {
    const cluster = createDefaultCluster();
    const port = cluster.nodes[0].hcas[0].ports[0];
    port.physicalState = "LinkDown";

    expect(getHostRailLinkStatus(cluster.nodes[0], 0)).toBe("down");
    expect(getInfiniBandLinkCounts(cluster)).toEqual({ active: 63, total: 64 });
  });
});
