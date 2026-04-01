export type SiteStatus = "online" | "offline" | "degraded" | "unknown";

export interface ManagedSite {
  id: string;
  name: string;
  address: string; // IP or hostname (e.g. "192.168.1.1", "modem.local")
  port?: number; // Optional port (defaults to 80)
  password: string; // Password for the remote QManager device
  notes?: string;
  addedAt: number; // Unix timestamp ms
  lastSeen?: number; // Unix timestamp ms of last successful check
  status: SiteStatus;
  // Snapshot of key metrics from last successful poll
  snapshot?: SiteSnapshot;
}

export interface SiteSnapshot {
  model?: string;
  firmware?: string;
  operator?: string;
  connectionType?: string; // "LTE", "NR5G-SA", "NR5G-NSA"
  band?: string;
  rsrp?: number | null;
  rsrq?: number | null;
  sinr?: number | null;
  ipAddress?: string;
  uptime?: string;
}

export interface AddSiteFormData {
  name: string;
  address: string;
  port?: number;
  password: string;
  notes?: string;
}
