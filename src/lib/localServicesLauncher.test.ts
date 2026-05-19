import { describe, expect, it, vi } from "vitest";
import { LOCAL_SERVICES_LAUNCH_URL, openLocalServicesLauncher } from "./localServicesLauncher";

describe("localServicesLauncher", () => {
  it("uses the registered Windows protocol URL", () => {
    expect(LOCAL_SERVICES_LAUNCH_URL).toBe("worksite-radar://start");
  });

  it("opens the registered launcher URL in the current tab", () => {
    const assign = vi.fn();

    openLocalServicesLauncher({ assign } as unknown as Location);

    expect(assign).toHaveBeenCalledWith("worksite-radar://start");
  });
});
