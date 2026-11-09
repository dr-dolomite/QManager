import enCommon from "@/public/locales/en/common.json";
import enSidebar from "@/public/locales/en/sidebar.json";
import enDashboard from "@/public/locales/en/dashboard.json";
import enOnboarding from "@/public/locales/en/onboarding.json";
import enSystemSettings from "@/public/locales/en/system-settings.json";
import enLocalNetwork from "@/public/locales/en/local-network.json";
import enMonitoring from "@/public/locales/en/monitoring.json";
import enEvents from "@/public/locales/en/events.json";
import enCellular from "@/public/locales/en/cellular.json";
import enErrors from "@/public/locales/en/errors.json";
import enAtCommands from "@/public/locales/en/at-commands.json";
import enHistory from "@/public/locales/en/history.json";
import zhCNCommon from "@/public/locales/zh-CN/common.json";
import zhCNSidebar from "@/public/locales/zh-CN/sidebar.json";
import zhCNDashboard from "@/public/locales/zh-CN/dashboard.json";
import zhCNOnboarding from "@/public/locales/zh-CN/onboarding.json";
import zhCNSystemSettings from "@/public/locales/zh-CN/system-settings.json";
import zhCNLocalNetwork from "@/public/locales/zh-CN/local-network.json";
import zhCNMonitoring from "@/public/locales/zh-CN/monitoring.json";
import zhCNEvents from "@/public/locales/zh-CN/events.json";
import zhCNCellular from "@/public/locales/zh-CN/cellular.json";
import zhCNErrors from "@/public/locales/zh-CN/errors.json";
import zhCNAtCommands from "@/public/locales/zh-CN/at-commands.json";
import zhCNHistory from "@/public/locales/zh-CN/history.json";

// Resources for i18next. Every bundled language must declare every namespace.
export const resources = {
  en: {
    common: enCommon,
    sidebar: enSidebar,
    dashboard: enDashboard,
    onboarding: enOnboarding,
    "system-settings": enSystemSettings,
    "local-network": enLocalNetwork,
    monitoring: enMonitoring,
    events: enEvents,
    cellular: enCellular,
    errors: enErrors,
    "at-commands": enAtCommands,
    history: enHistory,
  },
  "zh-CN": {
    common: zhCNCommon,
    sidebar: zhCNSidebar,
    dashboard: zhCNDashboard,
    onboarding: zhCNOnboarding,
    "system-settings": zhCNSystemSettings,
    "local-network": zhCNLocalNetwork,
    monitoring: zhCNMonitoring,
    events: zhCNEvents,
    cellular: zhCNCellular,
    errors: zhCNErrors,
    "at-commands": zhCNAtCommands,
    history: zhCNHistory,
  },
} as const;

export const DEFAULT_NAMESPACE = "common" as const;
export const ALL_NAMESPACES = [
  "common",
  "sidebar",
  "dashboard",
  "onboarding",
  "system-settings",
  "local-network",
  "monitoring",
  "events",
  "cellular",
  "errors",
  "at-commands",
  "history",
] as const;
