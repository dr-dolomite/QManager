"use client";

import * as React from "react";
import {
  LifeBuoy,
  Map,
  PieChart,
  Settings2,
  HomeIcon,
  RadioTowerIcon,
  LucideSignal,
  RadarIcon,
  MailIcon,
  EthernetPortIcon,
  MonitorCloudIcon,
  LogsIcon,
  MessageCircleIcon,
  WorkflowIcon,
  CardSimIcon,
  DogIcon,
  RouterIcon,
} from "lucide-react";

import { NavMain } from "@/components/nav-main";
import { NavLocalNetwork } from "@/components/nav-localNetwork";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { NavMonitoring } from "@/components/nav-monitoring";
import { NavCellular } from "@/components/nav-cellular";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const data = {
  user: {
    name: "user-test",
    avatar: "/qmanager-logo.png",
  },
  navMain: [
    {
      title: "Home",
      url: "/dashboard",
      icon: HomeIcon,
      isActive: true,
    },
  ],
  navSecondary: [
    {
      title: "SMS Center",
      url: "#",
      icon: MessageCircleIcon,
    },
    {
      title: "About Device",
      url: "#",
      icon: RouterIcon,
    },
    {
      title: "Support",
      url: "#",
      icon: LifeBuoy,
    },
  ],
  cellular: [
    {
      title: "Cellular Information",
      url: "/cellular",
      icon: RadioTowerIcon,
    },
    {
      title: "Custom Profile",
      url: "/cellular/custom-profile",
      icon: CardSimIcon,
    },
    {
      title: "Cell Locking",
      url: "#",
      icon: LucideSignal,
      items: [
        {
          title: "Band Selection",
          url: "#",
        },
        {
          title: "Tower Locking",
          url: "#",
        },
      ],
    },
    {
      title: "Cell Scanner",
      url: "#",
      icon: RadarIcon,
      items: [
        {
          title: "Neighboring Cells",
          url: "#",
        },
        {
          title: "Frequency Calculator",
          url: "#",
        },
      ],
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings2,
      items: [
        {
          title: "APN Management",
          url: "#",
        },
        {
          title: "Network Priority",
          url: "#",
        },
        {
          title: "IMEI Settings",
          url: "#",
        },
        {
          title: "FPLMN Settings",
          url: "#",
        },
      ],
    },
  ],
  localNetwork: [
    {
      title: "Ethernet Status",
      url: "#",
      icon: EthernetPortIcon,
    },
    {
      title: "IP Passthrough",
      url: "#",
      icon: WorkflowIcon,
    },
    {
      title: "Custom DNS",
      url: "#",
      icon: Map,
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings2,
      items: [
        {
          title: "TTL Settings",
          url: "#",
        },
        {
          title: "MTU Settings",
          url: "#",
        },
        {
          title: "USB & DNS Settings",
          url: "#",
        }
      ],
    },
  ],
  monitoring: [
    {
      title: "Network Analysis",
      url: "#",
      icon: PieChart,
      items: [
        {
          title: "Latency Monitor",
          url: "#",
        },
      ],
    },
    {
      title: "Email Alerts",
      url: "#",
      icon: MailIcon,
    },
    {
      title: "Tailscale",
      url: "#",
      icon: MonitorCloudIcon,
    },
    {
      title: "Watchdog",
      url: "#",
      icon: DogIcon,
    },
    {
      title: "Logs",
      url: "#",
      icon: LogsIcon,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="#">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                  <img src="/qmanager-logo.svg" alt="QManager Logo" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">QManager</span>
                  <span className="truncate text-xs">Admin</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavCellular cellular={data.cellular} />
        <NavLocalNetwork localNetwork={data.localNetwork} />
        <NavMonitoring monitoring={data.monitoring} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
