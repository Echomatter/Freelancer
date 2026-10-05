import { capabilityStatus } from '../domain/mcp.mjs';
export function toolLabel(row) {
  const status = capabilityStatus(row);
  return ({ 'Registered · use unverified': 'Loaded', 'Registered · permission unverified': 'Loaded',
    'Permission required': 'Needs permission', 'Permission depends on operation': 'Depends on action',
    'Operation restricted': 'Restricted', 'Explicitly restricted': 'Restricted',
     'Not registered': 'Unavailable', 'Not exposed by this model': 'Not exposed here',
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
  return ({ connected: 'Available', disabled: 'Disabled', failed: 'Error', error: 'Error', unavailable: 'Unavailable',
    needs_auth: 'Needs authentication', needs_setup: 'Needs setup', needs_client_registration: 'Needs setup', unverified: 'Unknown' })[status] ?? 'Unknown';
}
export function toolReason(row) {
  // The API can report "choose a model" when its optional model probe did not
  // run. This page deliberately has no model selector: do not suggest one.
  return row.discovered !== true || row.configured === false || row.nativePermission === 'deny'
    || row.applicationAccess === 'blocked' || row.modelExposure === false ? row.unavailableReason : null;
}
