import { useEffect, useMemo, useState } from "react";
import type { ClusterConfig } from "@/types/hardware";
import { scenarioContextManager } from "@/store/scenarioContext";

/** Returns the isolated scenario cluster, switching back when its context ends. */
export function useEffectiveCluster(globalCluster: ClusterConfig): ClusterConfig {
  const [contextState, setContextState] = useState(() => {
    const context = scenarioContextManager.getActiveContext();
    return { context, mutationCount: context?.getMutationCount() ?? 0 };
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const context = scenarioContextManager.getActiveContext();
      const mutationCount = context?.getMutationCount() ?? 0;
      setContextState((current) =>
        current.context === context && current.mutationCount === mutationCount
          ? current
          : { context, mutationCount },
      );
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return useMemo(
    () => contextState.context?.getCluster() ?? globalCluster,
    [contextState, globalCluster],
  );
}
