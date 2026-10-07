export function permissionMatches(granted: string, required: string) {
  if (required === "data.personal_export") return granted === required;
  return granted === "*" || granted === required ||
    (granted.endsWith(".*") && required.startsWith(granted.slice(0, -1))) ||
    (granted === "*.view" && required.endsWith(".view"));
}

export function hasPermission(grants: string[], required: string) {
  return grants.some((granted) => permissionMatches(granted, required));
}

export function permissionGranted(grants: string[], permission: string) {
  return hasPermission(grants, permission);
}
