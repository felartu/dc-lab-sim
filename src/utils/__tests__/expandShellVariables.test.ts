import { describe, expect, it } from "vitest";
import { expandShellVariables } from "../expandShellVariables";

describe("expandShellVariables", () => {
  it("expands USER for Slurm filters and preserves single-quoted variables", () => {
    expect(
      expandShellVariables(`squeue -u $USER '$USER' "$USER" \${USER}`, {
        USER: "root",
      }),
    ).toBe(`squeue -u root '$USER' "root" root`);
  });
  it("preserves escaped dollars and expands unknown names to empty strings", () => {
    expect(
      expandShellVariables("echo \\$USER $MISSING", { USER: "root" }),
    ).toBe("echo \\$USER ");
  });
});
