// =============================================================================
// LAN Config Types
// =============================================================================
// Type contracts for the LAN gateway/subnet editor.
// "Gateway" = network.lan.ipaddr (the router's own LAN IP, which clients use as
// their default gateway). "Subnet" = network.lan.netmask, chosen in the UI as a
// CIDR prefix. There is no network.lan.gateway key on a LAN bridge.
//
// Endpoint: GET/POST /cgi-bin/quecmanager/network/lan_config.sh
// =============================================================================

export interface LanConfigStatus {
  success: true;
  /** Bridge device, e.g. "br-lan" */
  device: string;
  /** Current LAN IPv4 address (the gateway) */
  ipaddr: string;
  /** Current subnet mask, e.g. "255.255.252.0" */
  netmask: string;
  /** CIDR prefix derived from the netmask, e.g. 22 */
  prefix: number;
}

export interface LanConfigSaveRequest {
  ipaddr: string;
  prefix: number;
}

export interface LanConfigSaveResponse {
  success: boolean;
  /** True once the change is committed and the deferred network reload is armed */
  apply_in_progress?: boolean;
  /** Seconds the LAN is expected to be unreachable while br-lan rebinds */
  disconnect_window_seconds?: number;
  /**
   * True when the backend will physically bounce the LAN port carrier after the
   * reload (only when ipaddr/netmask actually changed). A cable-sense upstream
   * router then re-runs DHCP and picks up the new gateway automatically — so the
   * UI can promise an automatic reconnect rather than a manual cable re-plug.
   */
  carrier_bounce?: boolean;
  /** The address the device will be reachable at after the reload */
  new_ipaddr?: string;
  netmask?: string;
  prefix?: number;
  error?: string;
  detail?: string;
}
