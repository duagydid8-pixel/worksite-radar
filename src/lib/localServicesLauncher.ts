export const LOCAL_SERVICES_LAUNCH_URL = "worksite-radar://start";

export function openLocalServicesLauncher(locationRef: Pick<Location, "assign"> = window.location): void {
  locationRef.assign(LOCAL_SERVICES_LAUNCH_URL);
}

export function requestLocalServicesStart(documentRef: Document = window.document): void {
  const iframe = documentRef.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = LOCAL_SERVICES_LAUNCH_URL;
  documentRef.body.appendChild(iframe);
}
