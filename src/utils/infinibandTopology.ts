import type { ClusterConfig, DGXNode, InfiniBandPort } from "@/types/hardware";

export function isInfiniBandPortActive(port: InfiniBandPort): boolean {
  return port.state === "Active" && port.physicalState === "LinkUp";
}

/** HCA array order maps to the fabric's rail order (HCA N → Rail N). */
export function getHostRailLinkStatus(
  host: Pick<DGXNode, "hcas"> | undefined,
  railIndex: number,
): "active" | "down" {
  const ports = host?.hcas[railIndex]?.ports ?? [];
  return ports.length > 0 && ports.every(isInfiniBandPortActive)
    ? "active"
    : "down";
}

export function getInfiniBandLinkCounts(cluster: ClusterConfig): {
  active: number;
  total: number;
} {
  const ports = cluster.nodes.flatMap((node) =>
    node.hcas.flatMap((hca) => hca.ports),
  );
  return {
    active: ports.filter(isInfiniBandPortActive).length,
    total: ports.length,
  };
}
