import { capabilityStatus } from '../domain/mcp.mjs';
export function toolLabel(row) {
  const status = capabilityStatus(row);
  return ({ 'Registered · use unverified': 'Loaded', 'Registered · permission unverified': 'Loaded',
    'Permission required': 'Needs permission', 'Permission depends on operation': 'Depends on action',
    'Operation restricted': 'Restricted', 'Explicitly restricted': 'Restricted',
    'Not registered': 'Unavailable', 'Not exposed by this model': 'Model unsupported',
    'Dependency unavailable': 'Unavailable' })[status] ?? status;
}
// Labels describe observations, never an authorization or a successful tool call.
export function registrationLabel(value) {
  return value === true ? 'Registered' : value === false ? 'Not registered' : 'Unknown';
}
export function skillLabel(row, probe) {
  if (row.dependency === 'missing') return 'Missing file';
  if (row.discovered === true) return 'Found';
  return probe?.state === 'observed' ? 'Not found' : 'Unknown';
}
export function serviceLabel(status) {
  return ({ connected: 'Connected', disabled: 'Disabled', failed: 'Connection failed', needs_auth: 'Sign-in needed',
    needs_client_registration: 'Registration needed', unverified: 'Unverified' })[status] ?? 'Unknown';
}
export function toolReason(row) {
  // The API can report "choose a model" when its optional model probe did not
  // run. This page deliberately has no model selector: do not suggest one.
  return row.discovered !== true || row.configured === false || row.nativePermission === 'deny'
    || row.applicationAccess === 'blocked' || row.modelExposure === false ? row.unavailableReason : null;
}
export function inventoryMatches(row, query) {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [row.id, row.name, row.origin, row.status, row.unavailableReason]
    .filter(value => typeof value === 'string').join(' ').toLocaleLowerCase().includes(needle);
}
