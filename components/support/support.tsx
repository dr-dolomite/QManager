"use client";

import Image from "next/image";
import { Mail, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// =============================================================================
// Discord icon — not available in lucide-react
// =============================================================================

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
  </svg>
);

// =============================================================================
// SupportComponent — static support page with contact and community cards
// =============================================================================

const SupportComponent = () => {
  const { t } = useTranslation("system-settings");

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("support.page.title")}</h1>
        <p className="text-muted-foreground">{t("support.page.subtitle")}</p>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        {/* Contact Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-muted-foreground" />
              {t("support.contact.card_title")}
            </CardTitle>
            <CardDescription>
              {t("support.contact.card_description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("support.contact.description")}
              </p>
              <div>
                <dl className="grid divide-y divide-border border-y border-border">
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-sm font-semibold text-muted-foreground">
                      {t("support.contact.fields.email_label")}
                    </dt>
                    <dd className="text-sm font-semibold min-w-0">
                      <a
                        href="mailto:russel.yasol@gmail.com"
                        className="inline-flex items-center gap-1.5 py-1 text-primary hover:underline underline-offset-4 truncate"
                        title="russel.yasol@gmail.com"
                      >
                        russel.yasol@gmail.com
                      </a>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-sm font-semibold text-muted-foreground">
                      {t("support.contact.fields.github_label")}
                    </dt>
                    <dd className="text-sm font-semibold">
                      <a
                        href="https://github.com/dr-dolomite"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 py-1 text-primary hover:underline underline-offset-4"
                      >
                        dr-dolomite
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Community Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DiscordIcon className="h-5 w-5 text-muted-foreground" />
              {t("support.community.card_title")}
            </CardTitle>
            <CardDescription>
              {t("support.community.card_description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("support.community.description")}
              </p>
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-lg border border-border bg-muted p-2">
                  <Image
                    src="/discord-qr.svg"
                    alt={t("support.community.qr_alt")}
                    width={192}
                    height={192}
                    className="size-48"
                  />
                </div>
                <a
                  href="https://discord.iamromulan.dev/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 py-1 text-sm font-semibold text-primary hover:underline underline-offset-4"
                >
                  discord.iamromulan.dev/
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SupportComponent;
