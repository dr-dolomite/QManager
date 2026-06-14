"use client";

import * as React from "react";
import {
  LifeBuoy,
  PieChart,
  Settings2,
  HomeIcon,
  RadioTowerIcon,
  LucideSignal,
  EthernetPortIcon,
  BirdIcon,
  MessageCircleIcon,
  DogIcon,
  RouterIcon,
  User2Icon,
  HeartIcon,
  ScanIcon,
  SettingsIcon,
  TerminalIcon,
  DownloadIcon,
  WaypointsIcon,
  MonitorPlay,
} from "lucide-react";

import QManagerLogo from "@/public/qmanager-logo.svg";

import { AppSwitcher } from "@/components/app-switcher";
import { NavMain } from "@/components/nav-main";
import { NavLocalNetwork } from "@/components/nav-localNetwork";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { NavMonitoring } from "@/components/nav-monitoring";
import { NavCellular } from "@/components/nav-cellular";
import { NavSystem } from "@/components/nav-system";
import DonateDialog from "@/components/donate-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";

// t_key values are keys inside the "sidebar" namespace's "items" object.
const data = {
  user: {
    name: "Admin",
    avatar: QManagerLogo.src,
  },
  navMain: [
    {
      t_key: "home",
      url: "/dashboard",
      icon: HomeIcon,
      isActive: true,
    },
  ],
  system: [
    {
      t_key: "system_settings",
      url: "/system-settings",
      icon: SettingsIcon,
      items: [
        { t_key: "languages", url: "/system-settings/languages" },
        {
          t_key: "configuration_backup",
          url: "/system-settings/config-backup",
        },
        {
          t_key: "connection_quality",
          url: "/system-settings/connection-quality",
        },
        {
          t_key: "adaptive_polling",
          url: "/system-settings/adaptive-polling",
        },
        {
          t_key: "bandwidth_monitor",
          url: "/system-settings/bandwidth-monitor",
        },
        { t_key: "logs", url: "/system-settings/logs" },
      ],
    },
    {
      t_key: "software_update",
      url: "/system-settings/software-update",
      icon: DownloadIcon,
    },
    {
      t_key: "at_terminal",
      url: "/system-settings/at-terminal",
      icon: TerminalIcon,
    },
  ],
  navSecondary: [
    { t_key: "about_device", url: "/about-device", icon: RouterIcon },
    { t_key: "support", url: "/support", icon: LifeBuoy },
    { t_key: "donate", url: "#", icon: HeartIcon },
  ],
  cellular: [
    {
      t_key: "cellular_information",
      url: "/cellular",
      icon: RadioTowerIcon,
      items: [
        { t_key: "antenna_statistics", url: "/cellular/antenna-statistics" },
        { t_key: "antenna_alignment", url: "/cellular/antenna-alignment" },
      ],
    },
    {
      t_key: "sms_center",
      url: "/cellular/sms",
      icon: MessageCircleIcon,
      items: [{ t_key: "forwarding", url: "/cellular/sms/forwarding" }],
    },
    {
      t_key: "custom_profiles",
      url: "/cellular/custom-profiles",
      icon: User2Icon,
      items: [
        {
          t_key: "connection_scenarios",
          url: "/cellular/custom-profiles/connection-scenarios",
        },
      ],
    },
    {
      t_key: "band_locking",
      url: "/cellular/cell-locking",
      icon: LucideSignal,
      items: [
        { t_key: "tower_locking", url: "/cellular/cell-locking/tower-locking" },
        {
          t_key: "frequency_locking",
          url: "/cellular/cell-locking/frequency-locking",
        },
      ],
    },
    {
      t_key: "cell_scanner",
      url: "/cellular/cell-scanner",
      icon: ScanIcon,
      items: [
        {
          t_key: "neighboring_cells",
          url: "/cellular/cell-scanner/neighbourcell-scanner",
        },
        {
          t_key: "frequency_calculator",
          url: "/cellular/cell-scanner/frequency-calculator",
        },
      ],
    },
    {
      t_key: "settings",
      url: "/cellular/settings",
      icon: Settings2,
      items: [
        { t_key: "apn_management", url: "/cellular/settings/apn-management" },
        {
          t_key: "network_priority",
          url: "/cellular/settings/network-priority",
        },
        { t_key: "imei_settings", url: "/cellular/settings/imei-settings" },
        { t_key: "fplmn_settings", url: "/cellular/settings/fplmn-settings" },
      ],
    },
  ],
  localNetwork: [
    { t_key: "ethernet_status", url: "/local-network", icon: EthernetPortIcon },
    {
      t_key: "traffic_engine",
      url: "/local-network/traffic-engine",
      icon: MonitorPlay,
    },
    {
      t_key: "local_network_settings",
      url: "/local-network/ip-passthrough",
      icon: Settings2,
      items: [
        { t_key: "custom_dns", url: "/local-network/custom-dns" },
        { t_key: "ttl_mtu_settings", url: "/local-network/ttl-settings" },
      ],
    },
  ],
  monitoring: [
    {
      t_key: "network_events",
      url: "/monitoring",
      icon: PieChart,
      items: [
        { t_key: "latency_monitor", url: "/monitoring/latency" },
        { t_key: "email_alerts", url: "/monitoring/email-alerts" },
        { t_key: "sms_alerts", url: "/monitoring/sms-alerts" },
      ],
    },
    { t_key: "tailscale", url: "/monitoring/tailscale", icon: WaypointsIcon },
    { t_key: "netbird", url: "/monitoring/netbird", icon: BirdIcon },
    { t_key: "watchdog", url: "/monitoring/watchdog", icon: DogIcon },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [donateOpen, setDonateOpen] = React.useState(false);

  const navSecondaryItems = data.navSecondary.map((item) =>
    item.t_key === "donate"
      ? { ...item, onClick: () => setDonateOpen(true) }
      : item,
  );

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <AppSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavCellular cellular={data.cellular} />
        <NavLocalNetwork localNetwork={data.localNetwork} />
        <NavMonitoring monitoring={data.monitoring} />
        <NavSystem system={data.system} />
        <NavSecondary items={navSecondaryItems} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
    </Sidebar>
  );
}
