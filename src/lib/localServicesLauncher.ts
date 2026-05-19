export const LOCAL_SERVICES_LAUNCH_URL = "worksite-radar://start";

export function openLocalServicesLauncher(locationRef: Pick<Location, "assign"> = window.location): void {
  locationRef.assign(LOCAL_SERVICES_LAUNCH_URL);
}
