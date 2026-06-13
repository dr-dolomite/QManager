// types/ipa-offload.ts
//
// Response shapes for the IPA hardware-offload endpoint.
// Backend: /cgi-bin/quecmanager/system/ipa_offload.sh
//   GET                          → { success: true, available, enabled }
//   POST {"action":"enable"|"disable"} → { success: true, enabled, pending_reboot_required: true }
//   error                        → { success: false, error: CODE, detail?: MSG }

export interface IpaOffloadState {
  available: boolean;
  enabled: boolean;
}

export interface IpaOffloadGetSuccess {
  success: true;
  available: boolean;
  enabled: boolean;
}

export interface IpaOffloadPostSuccess {
  success: true;
  enabled: boolean;
  pending_reboot_required: true;
}

export interface IpaOffloadError {
  success: false;
  error: string;
  detail?: string;
}

export type IpaOffloadGetResponse = IpaOffloadGetSuccess | IpaOffloadError;
export type IpaOffloadPostResponse = IpaOffloadPostSuccess | IpaOffloadError;
