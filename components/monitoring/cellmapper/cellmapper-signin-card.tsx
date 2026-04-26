"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  ExternalLinkIcon,
  AlertTriangleIcon,
  LogInIcon,
} from "lucide-react";

// =============================================================================
// CellMapperSignInCard — Account linking form.
//
// Full card mode (!isLinked && !reAuthMode): shows the complete sign-in form,
// register link, and optional sign-out if already linked.
//
// Re-auth banner mode (reAuthMode): compact warning alert with an expandable
// inline form — no dialog, no full-page replacement.
// =============================================================================

interface CellMapperSignInCardProps {
  isLinked: boolean;
  username: string | null;
  onSignIn: (username: string, password: string) => Promise<boolean>;
  onSignOut?: () => Promise<boolean>;
  /** Re-auth mode: shown as inline banner, not full-page replacement */
  reAuthMode?: boolean;
}

// ─── Shared sign-in form ─────────────────────────────────────────────────────

interface SignInFormProps {
  onSignIn: (username: string, password: string) => Promise<boolean>;
  compact?: boolean;
}

function SignInForm({ onSignIn, compact = false }: SignInFormProps) {
  const { t } = useTranslation("monitoring");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = async () => {
    if (!username.trim() || !password.trim()) return;
    setIsSigningIn(true);
    try {
      const ok = await onSignIn(username, password);
      if (ok) {
        toast.success(t("cellmapper.toast_signin_success", { username }));
        setPassword(""); // Clear password on success
      } else {
        toast.error(t("cellmapper.toast_signin_error"));
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      void handleSignIn();
    }
  };

  return (
    <div className={compact ? "space-y-3 pt-3" : "space-y-4"}>
      <div className="space-y-1.5">
        <Label htmlFor="cellmapper-username">
          {t("cellmapper.signin_label_username")}
        </Label>
        <Input
          id="cellmapper-username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("cellmapper.signin_placeholder_username")}
          disabled={isSigningIn}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cellmapper-password">
          {t("cellmapper.signin_label_password")}
        </Label>
        <Input
          id="cellmapper-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("cellmapper.signin_placeholder_password")}
          disabled={isSigningIn}
        />
      </div>

      <Button
        onClick={() => void handleSignIn()}
        disabled={!username.trim() || !password.trim() || isSigningIn}
        className={compact ? "w-full" : undefined}
      >
        {isSigningIn ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t("cellmapper.signin_signing_in")}
          </>
        ) : (
          <>
            <LogInIcon className="size-4" />
            {t("cellmapper.signin_button")}
          </>
        )}
      </Button>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CellMapperSignInCard({
  isLinked,
  username,
  onSignIn,
  onSignOut,
  reAuthMode = false,
}: CellMapperSignInCardProps) {
  const { t } = useTranslation("monitoring");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [reAuthExpanded, setReAuthExpanded] = useState(false);

  // ── Re-auth banner mode ──────────────────────────────────────────────────
  if (reAuthMode) {
    return (
      <Alert className="border-warning/30 bg-warning/5">
        <AlertTriangleIcon className="size-4 text-warning" />
        <AlertDescription>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">
              {t("cellmapper.reauth_session_expired")}
            </span>
            {!reAuthExpanded && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReAuthExpanded(true)}
              >
                {t("cellmapper.reauth_button")}
              </Button>
            )}
          </div>

          <AnimatePresence>
            {reAuthExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                style={{ overflow: "hidden" }}
              >
                <SignInForm onSignIn={onSignIn} compact />
              </motion.div>
            )}
          </AnimatePresence>
        </AlertDescription>
      </Alert>
    );
  }

  // ── Full card mode ───────────────────────────────────────────────────────
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("cellmapper.signin_card_title")}</CardTitle>
        <CardDescription>{t("cellmapper.signin_card_description")}</CardDescription>
      </CardHeader>
      <CardContent aria-live="polite">
        {isLinked && username ? (
          // Already linked — show account info + sign-out
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("cellmapper.signin_already_linked", { username })}
            </p>
            {onSignOut && (
              <Button
                variant="outline"
                size="sm"
                disabled={isSigningOut}
                onClick={async () => {
                  setIsSigningOut(true);
                  try {
                    const ok = await onSignOut();
                    if (ok) {
                      toast.success(t("cellmapper.toast_signout_success"));
                    } else {
                      toast.error(t("cellmapper.toast_signout_error"));
                    }
                  } finally {
                    setIsSigningOut(false);
                  }
                }}
              >
                {isSigningOut ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("cellmapper.signin_signing_out")}
                  </>
                ) : (
                  t("cellmapper.signout_button")
                )}
              </Button>
            )}
          </div>
        ) : (
          // Not linked — show sign-in form
          <div className="space-y-5">
            <SignInForm onSignIn={onSignIn} />

            {/* Register link */}
            <div className="flex flex-col gap-1 pt-1">
              <p className="text-sm text-muted-foreground">
                {t("cellmapper.signin_no_account")}
              </p>
              <a
                href="https://www.cellmapper.net/register"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
              >
                {t("cellmapper.signin_register_link")}
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
