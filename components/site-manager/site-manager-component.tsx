"use client";

import React, { useState } from "react";
import { motion, type Variants } from "motion/react";
import {
  PlusIcon,
  RefreshCwIcon,
  ExternalLinkIcon,
  TrashIcon,
  PencilIcon,
  ServerIcon,
  WifiIcon,
  WifiOffIcon,
  AlertTriangleIcon,
  CircleHelpIcon,
  SignalIcon,
  GlobeIcon,
  RadioTowerIcon,
  EyeIcon,
  EyeOffIcon,
} from "lucide-react";
import { useSiteManager } from "@/hooks/use-site-manager";
import type { ManagedSite, AddSiteFormData } from "@/types/site-manager";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";

// Animation variants
const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" },
  },
};

// Status helpers
function getStatusBadgeVariant(status: ManagedSite["status"]) {
  switch (status) {
    case "online":
      return "success" as const;
    case "degraded":
      return "warning" as const;
    case "offline":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

function getStatusIcon(status: ManagedSite["status"]) {
  switch (status) {
    case "online":
      return <WifiIcon className="size-4" />;
    case "degraded":
      return <AlertTriangleIcon className="size-4" />;
    case "offline":
      return <WifiOffIcon className="size-4" />;
    default:
      return <CircleHelpIcon className="size-4" />;
  }
}

function formatLastSeen(ts?: number): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// =============================================================================
// Add/Edit Site Dialog
// =============================================================================

function SiteFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initial,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: AddSiteFormData) => void;
  initial?: Partial<AddSiteFormData>;
  title: string;
  description: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [port, setPort] = useState(initial?.port?.toString() ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [showPassword, setShowPassword] = useState(false);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setAddress(initial?.address ?? "");
      setPort(initial?.port?.toString() ?? "");
      setPassword(initial?.password ?? "");
      setShowPassword(false);
      setNotes(initial?.notes ?? "");
    }
  }, [open, initial]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !address.trim() || !password) return;
    onSubmit({
      name: name.trim(),
      address: address.trim(),
      port: port ? parseInt(port, 10) : undefined,
      password,
      notes: notes.trim() || undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <FieldGroup>
            <Field>
              <FieldLabel>Site Name</FieldLabel>
              <Input
                placeholder="Home Router"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
              <FieldDescription>
                A friendly label for this device
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Address</FieldLabel>
              <Input
                placeholder="192.168.1.1"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
              />
              <FieldDescription>
                IP address or hostname of the QManager device
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Port</FieldLabel>
              <Input
                type="number"
                placeholder="80"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
              <FieldDescription>
                Leave empty for default (80)
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Password</FieldLabel>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Device password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOffIcon className="size-3.5" />
                  ) : (
                    <EyeIcon className="size-3.5" />
                  )}
                </Button>
              </div>
              <FieldDescription>
                Password for the remote QManager device
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Notes</FieldLabel>
              <Textarea
                placeholder="Rooftop antenna, T-Mobile SIM..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !address.trim() || !password}>
              {initial ? "Save Changes" : "Add Site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Delete Confirmation Dialog
// =============================================================================

function DeleteConfirmDialog({
  open,
  onOpenChange,
  siteName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteName: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove Site</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove <strong>{siteName}</strong>? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Site Card
// =============================================================================

function SiteCard({
  site,
  onOpen,
  onEdit,
  onDelete,
  onRefresh,
}: {
  site: ManagedSite;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    await onRefresh();
    setIsRefreshing(false);
  }

  return (
    <Card className="@container/card group relative">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <ServerIcon className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate">{site.name}</CardTitle>
            <CardDescription className="font-mono text-xs">
              {site.address}
              {site.port && site.port !== 80 ? `:${site.port}` : ""}
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <div className="flex items-center gap-1">
            <Badge variant={getStatusBadgeVariant(site.status)}>
              {getStatusIcon(site.status)}
              <span className="capitalize">{site.status}</span>
            </Badge>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* Snapshot metrics */}
        {site.snapshot ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {site.snapshot.connectionType && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <RadioTowerIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {site.snapshot.connectionType}
                  {site.snapshot.band ? ` · ${site.snapshot.band}` : ""}
                </span>
              </div>
            )}
            {site.snapshot.operator && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <GlobeIcon className="size-3.5 shrink-0" />
                <span className="truncate">{site.snapshot.operator}</span>
              </div>
            )}
            {site.snapshot.rsrp != null && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <SignalIcon className="size-3.5 shrink-0" />
                <span className="font-mono text-xs">
                  RSRP: {site.snapshot.rsrp} dBm
                </span>
              </div>
            )}
            {site.snapshot.sinr != null && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <SignalIcon className="size-3.5 shrink-0" />
                <span className="font-mono text-xs">
                  SINR: {site.snapshot.sinr} dB
                </span>
              </div>
            )}
            {site.snapshot.model && (
              <div className="col-span-2 flex items-center gap-2 text-muted-foreground">
                <ServerIcon className="size-3.5 shrink-0" />
                <span className="truncate text-xs">{site.snapshot.model}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {site.status === "unknown"
              ? "Checking status..."
              : site.status === "offline"
              ? "Device unreachable"
              : "No data available"}
          </p>
        )}

        {/* Notes */}
        {site.notes && (
          <p className="mt-3 text-xs text-muted-foreground/70 truncate">
            {site.notes}
          </p>
        )}

        {/* Footer actions */}
        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <span className="text-xs text-muted-foreground">
            Last seen: {formatLastSeen(site.lastSeen)}
          </span>
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? (
                      <Spinner className="size-3" />
                    ) : (
                      <RefreshCwIcon className="size-3" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh status</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={onEdit}>
                    <PencilIcon className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit site</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={onDelete}>
                    <TrashIcon className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove site</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={onOpen}>
                    <ExternalLinkIcon className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open dashboard</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Site Card Skeleton
// =============================================================================

function SiteCardSkeleton() {
  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <div className="mt-4 border-t pt-4">
          <Skeleton className="h-3 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function SiteManagerComponent() {
  const {
    sites,
    isLoading,
    isPolling,
    addSite,
    removeSite,
    updateSite,
    refreshSite,
    pollAllSites,
    openSite,
  } = useSiteManager();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<ManagedSite | null>(null);
  const [deletingSite, setDeletingSite] = useState<ManagedSite | null>(null);

  // Summary counts
  const onlineCount = sites.filter((s) => s.status === "online").length;
  const offlineCount = sites.filter((s) => s.status === "offline").length;
  const degradedCount = sites.filter((s) => s.status === "degraded").length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3">
          <SiteCardSkeleton />
          <SiteCardSkeleton />
          <SiteCardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Site Manager
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitor and manage your QManager devices in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sites.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={pollAllSites}
              disabled={isPolling}
            >
              {isPolling ? (
                <Spinner className="size-4" />
              ) : (
                <RefreshCwIcon className="size-4" />
              )}
              Refresh All
            </Button>
          )}
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Site
          </Button>
        </div>
      </div>

      {/* Summary badges */}
      {sites.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {sites.length} {sites.length === 1 ? "site" : "sites"}
          </Badge>
          {onlineCount > 0 && (
            <Badge variant="success">
              <WifiIcon className="size-3" />
              {onlineCount} online
            </Badge>
          )}
          {degradedCount > 0 && (
            <Badge variant="warning">
              <AlertTriangleIcon className="size-3" />
              {degradedCount} degraded
            </Badge>
          )}
          {offlineCount > 0 && (
            <Badge variant="destructive">
              <WifiOffIcon className="size-3" />
              {offlineCount} offline
            </Badge>
          )}
        </div>
      )}

      {/* Site grid or empty state */}
      {sites.length === 0 ? (
        <Empty className="min-h-100 border">
          <EmptyMedia variant="icon">
            <ServerIcon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No Sites Configured</EmptyTitle>
            <EmptyDescription>
              Add your QManager devices to monitor them all from this central
              dashboard. You&apos;ll see live status, signal metrics, and quick
              access to each device.
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => setAddDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Your First Site
          </Button>
        </Empty>
      ) : (
        <motion.div
          className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {sites.map((site) => (
            <motion.div key={site.id} variants={itemVariants}>
              <SiteCard
                site={site}
                onOpen={() => openSite(site)}
                onEdit={() => setEditingSite(site)}
                onDelete={() => setDeletingSite(site)}
                onRefresh={() => refreshSite(site.id)}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Add Site Dialog */}
      <SiteFormDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSubmit={addSite}
        title="Add Site"
        description="Add a QManager device to monitor from this dashboard."
      />

      {/* Edit Site Dialog */}
      {editingSite && (
        <SiteFormDialog
          open={!!editingSite}
          onOpenChange={(open) => !open && setEditingSite(null)}
          onSubmit={(data) => {
            updateSite(editingSite.id, data);
            setEditingSite(null);
          }}
          initial={{
            name: editingSite.name,
            address: editingSite.address,
            port: editingSite.port,
            password: editingSite.password,
            notes: editingSite.notes,
          }}
          title="Edit Site"
          description="Update the details for this QManager device."
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deletingSite && (
        <DeleteConfirmDialog
          open={!!deletingSite}
          onOpenChange={(open) => !open && setDeletingSite(null)}
          siteName={deletingSite.name}
          onConfirm={() => {
            removeSite(deletingSite.id);
            setDeletingSite(null);
          }}
        />
      )}
    </div>
  );
}
