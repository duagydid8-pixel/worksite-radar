import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_SERVICES_LAUNCH_URL,
  openLocalServicesLauncher,
  requestLocalServicesStart,
} from "./localServicesLauncher";

describe("localServicesLauncher", () => {
  it("uses the registered Windows protocol URL", () => {
    expect(LOCAL_SERVICES_LAUNCH_URL).toBe("worksite-radar://start");
  });

  it("opens the registered launcher URL in the current tab", () => {
    const assign = vi.fn();

    openLocalServicesLauncher({ assign } as unknown as Location);

    expect(assign).toHaveBeenCalledWith("worksite-radar://start");
  });

  it("can request local services from an iframe without replacing the current page", () => {
    const documentRef = document.implementation.createHTMLDocument();

    requestLocalServicesStart(documentRef);

    const iframe = documentRef.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(LOCAL_SERVICES_LAUNCH_URL);
    expect(iframe?.style.display).toBe("none");
  });
});
