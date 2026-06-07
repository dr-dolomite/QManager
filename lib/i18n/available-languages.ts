import type { LanguageCode, LanguageMeta } from "@/types/i18n";

export const DEFAULT_LANGUAGE: LanguageCode = "en";

export const AVAILABLE_LANGUAGES: readonly LanguageMeta[] = [
  {
    code: "en",
    native_name: "English",
    english_name: "English",
    rtl: false,
    bundled: true,
  },
  {
    code: "zh-CN",
    native_name: "简体中文",
    english_name: "Simplified Chinese",
    rtl: false,
    bundled: true,
  },
  // Downloadable placeholders — Plan 11. `bundled: false` means the pack is NOT
  // shipped in the firmware tarball; the Languages card downloads it from the
  // remote manifest on demand. These entries let the LanguageSwitcher render
  // a native name before the manifest has been fetched.
  //
  // RTL languages intentionally omitted: QManager does not support right-to-left
  // layout in v1. Physical spacing utilities (`ml-*`, `pl-*`, etc.) are still
  // used throughout the codebase, so an RTL language would render with broken
  // margins and arrow directions. Re-enable when a future plan establishes the
  // logical-utilities + DirectionalIcon foundation (spec §7.2, parked).
  // {
  //   code: "fr",
  //   native_name: "Français",
  //   english_name: "French",
  //   rtl: false,
  //   bundled: false,
  // },
  // {
  //   code: "de",
  //   native_name: "Deutsch",
  //   english_name: "German",
  //   rtl: false,
  //   bundled: false,
  // },
  {
    code: "it",
    native_name: "Italiano",
    english_name: "Italian",
    rtl: false,
    bundled: false,
  },
  {
    code: "id",
    native_name: "Indonesia",
    english_name: "Indonesian",
    rtl: false,
    bundled: false,
  },
  {
    code: "zh-TW",
    native_name: "繁體中文",
    english_name: "Traditional Chinese",
    rtl: false,
    bundled: false,
  },
];

export const BUNDLED_CODES: readonly LanguageCode[] =
  AVAILABLE_LANGUAGES.filter((l) => l.bundled).map((l) => l.code);

export const ALL_CATALOG_CODES: readonly LanguageCode[] =
  AVAILABLE_LANGUAGES.map((l) => l.code);

export function getLanguage(code: LanguageCode): LanguageMeta | undefined {
  return AVAILABLE_LANGUAGES.find((l) => l.code === code);
}

export function isRtl(code: LanguageCode): boolean {
  return getLanguage(code)?.rtl ?? false;
}
