"use client";

import { useTranslation } from "react-i18next";
import SmsForwardingCard from "./sms-forwarding-card";
import CallForwardingCard from "./call-forwarding-card";

const ForwardingCenterComponent = () => {
  const { t } = useTranslation("cellular");

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
          {t("sms.forwarding.page.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("sms.forwarding.page.description")}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <SmsForwardingCard />
        <CallForwardingCard />
      </div>
    </div>
  );
};

export default ForwardingCenterComponent;
