"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import {
  TbDotsVertical,
  TbEye,
  TbTrash,
  TbRefresh,
  TbPlus,
} from "react-icons/tb";
import { AlertCircleIcon, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MotionTableRow = motion.create(TableRow);
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

import type { SmsData } from "@/hooks/use-sms";
import type { SmsMessage } from "@/types/sms";
import SmsComposeDialog from "./sms-compose-dialog";

// =============================================================================
// SmsInboxCard — Displays SMS messages in a table with view/delete actions
// =============================================================================

interface SmsInboxCardProps {
  data: SmsData | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Error from the hook (fetch or mutation failure) */
  error: string | null;
  onSend: (phone: string, message: string) => Promise<boolean>;
  onDelete: (indexes: number[]) => Promise<boolean>;
  onDeleteAll: () => Promise<boolean>;
  onRefresh: () => void;
}

export default function SmsInboxCard({
  data,
  isLoading,
  isSaving,
  error,
  onSend,
  onDelete,
  onDeleteAll,
  onRefresh,
}: SmsInboxCardProps) {
  const { t } = useTranslation("cellular");
  const [viewMessage, setViewMessage] = React.useState<SmsMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<SmsMessage | null>(
    null,
  );
  const [showDeleteAll, setShowDeleteAll] = React.useState(false);
  const [showDeleteSelected, setShowDeleteSelected] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [showCompose, setShowCompose] = React.useState(false);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const success = await onDelete(deleteTarget.indexes);
    setIsDeleting(false);
    setDeleteTarget(null);
    if (success) {
      toast.success(t("sms.inbox.toast.delete_success"));
    } else {
      toast.error(t("sms.inbox.toast.delete_error"));
    }
  };

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    const success = await onDeleteAll();
    setIsDeleting(false);
    setShowDeleteAll(false);
    setRowSelection({});
    if (success) {
      toast.success(t("sms.inbox.toast.delete_all_success"));
    } else {
      toast.error(t("sms.inbox.toast.delete_all_error"));
    }
  };

  const handleDeleteSelected = async () => {
    const selectedRows = table.getSelectedRowModel().rows;
    if (selectedRows.length === 0) return;

    setIsDeleting(true);
    // Collect all indexes from all selected messages
    const allIndexes = selectedRows.flatMap((row) => row.original.indexes);
    const success = await onDelete(allIndexes);
    const count = selectedRows.length;
    setIsDeleting(false);
    setShowDeleteSelected(false);
    setRowSelection({});
    if (success) {
      toast.success(t("sms.inbox.toast.delete_selected_success", { count }));
    } else {
      toast.error(t("sms.inbox.toast.delete_selected_error"));
    }
  };

  const selectedCount = Object.keys(rowSelection).length;

  const columns: ColumnDef<SmsMessage>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table: tbl }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={
                tbl.getIsAllPageRowsSelected() ||
                (tbl.getIsSomePageRowsSelected() && "indeterminate")
              }
              onCheckedChange={(value) =>
                tbl.toggleAllPageRowsSelected(!!value)
              }
              aria-label={t("sms.inbox.table.select_all_aria")}
            />
          </div>
        ),
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label={t("sms.inbox.table.select_row_aria")}
            />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "sender",
        header: t("sms.inbox.table.headers.from"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium truncate">{row.original.sender}</div>
            <span className="block text-xs text-muted-foreground @sm/card:hidden">
              {row.original.timestamp}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "content",
        header: () => (
          <span className="hidden @md/card:inline">{t("sms.inbox.table.headers.message")}</span>
        ),
        cell: ({ row }) => (
          <div className="hidden @md/card:block max-w-xs truncate text-muted-foreground">
            {row.original.content}
          </div>
        ),
      },
      {
        id: "date",
        header: () => (
          <span className="hidden @sm/card:inline">{t("sms.inbox.table.headers.date")}</span>
        ),
        cell: ({ row }) => (
          <span className="hidden @sm/card:inline text-muted-foreground text-sm whitespace-nowrap">
            {row.original.timestamp}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
                  size="icon"
                >
                  <TbDotsVertical />
                  <span className="sr-only">{t("sms.inbox.table.actions.open_menu")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => setViewMessage(row.original)}>
                  <TbEye className="size-4" />
                  {t("sms.inbox.table.actions.view")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteTarget(row.original)}
                >
                  <TbTrash className="size-4" />
                  {t("sms.inbox.table.actions.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [t],
  );

  const table = useReactTable({
    data: data?.messages ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
    },
    initialState: {
      pagination: { pageSize: 10 },
    },
  });

  // --- Loading state ---------------------------------------------------------
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-5 w-20" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-48" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state (fetch failed, no data) ----------------------------------
  if (error && !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("sms.inbox.title")}</CardTitle>
          <CardDescription>
            {t("sms.inbox.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="alert"
            className="flex flex-col items-center gap-3 py-8 text-center"
          >
            <AlertCircleIcon className="size-8 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("sms.inbox.error.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("sms.inbox.error.description_prefix")}{error ? `: ${error}` : ""}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <TbRefresh className="size-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const messages = data?.messages ?? [];
  const storage = data?.storage;

  return (
    <>
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("sms.inbox.title")}</CardTitle>
          <CardDescription>
            {t("sms.inbox.description")}
            {storage && t("sms.inbox.storage_suffix", { used: storage.used, total: storage.total })}
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isSaving}
                aria-label={t("sms.inbox.buttons.refresh_aria")}
              >
                <TbRefresh className="size-4" />
              </Button>
              {selectedCount > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteSelected(true)}
                  disabled={isSaving}
                  aria-label={t("sms.inbox.buttons.delete_selected_aria", { count: selectedCount })}
                >
                  <Trash2 className="size-4" />
                  <span className="hidden @sm/card:inline">
                    {t("sms.inbox.buttons.delete_selected", { count: selectedCount })}
                  </span>
                </Button>
              )}
              {messages.length > 0 && selectedCount === 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteAll(true)}
                  disabled={isSaving}
                  aria-label={t("sms.inbox.buttons.delete_all_aria")}
                >
                  <Trash2 className="size-4" />
                  <span className="hidden @sm/card:inline">{t("sms.inbox.buttons.delete_all")}</span>
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setShowCompose(true)}
                disabled={isSaving}
              >
                <TbPlus className="size-4" />
                <span className="hidden @xs/card:inline">{t("sms.inbox.buttons.new_message")}</span>
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted sticky top-0 z-10">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row, index) => (
                    <MotionTableRow
                      key={row.id}
                      className="cursor-pointer"
                      tabIndex={0}
                      aria-label={t("sms.inbox.view_dialog.title", { sender: row.original.sender })}
                      onClick={() => setViewMessage(row.original)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setViewMessage(row.original);
                        }
                      }}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(index * 0.04, 0.4), ease: "easeOut" }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </MotionTableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      {t("sms.inbox.table.empty_row")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {messages.length > 0 && (
            <div className="flex items-center justify-between px-2 pt-2">
              <span className="text-muted-foreground text-sm">
                {t("sms.inbox.pagination.total", { count: messages.length })}
              </span>
              {table.getPageCount() > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    {t("sms.inbox.buttons.prev")}
                  </Button>
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {t("sms.inbox.pagination.page_info", {
                      current: table.getState().pagination.pageIndex + 1,
                      total: table.getPageCount(),
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    {t("sms.inbox.buttons.next")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Message Dialog */}
      <Dialog
        open={!!viewMessage}
        onOpenChange={(open) => !open && setViewMessage(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("sms.inbox.view_dialog.title", { sender: viewMessage?.sender ?? "" })}
            </DialogTitle>
            <DialogDescription>{viewMessage?.timestamp}</DialogDescription>
          </DialogHeader>
          <div className="whitespace-pre-wrap wrap-break-word text-sm">
            {viewMessage?.content}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Single Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sms.inbox.delete_single_confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sms.inbox.delete_single_confirm.description", { sender: deleteTarget?.sender ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("sms.inbox.delete_single_confirm.deleting")}
                </>
              ) : (
                t("sms.inbox.delete_single_confirm.confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Confirmation */}
      <AlertDialog
        open={showDeleteAll}
        onOpenChange={(open) => !open && setShowDeleteAll(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sms.inbox.delete_all_confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sms.inbox.delete_all_confirm.description", { count: messages.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("sms.inbox.delete_single_confirm.deleting")}
                </>
              ) : (
                t("sms.inbox.delete_all_confirm.confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Selected Confirmation */}
      <AlertDialog
        open={showDeleteSelected}
        onOpenChange={(open) => !open && setShowDeleteSelected(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sms.inbox.delete_selected_confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sms.inbox.delete_selected_confirm.description", { count: selectedCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSelected}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("sms.inbox.delete_selected_confirm.deleting")}
                </>
              ) : (
                t("sms.inbox.delete_selected_confirm.confirm", { count: selectedCount })
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Compose Dialog */}
      <SmsComposeDialog
        open={showCompose}
        onOpenChange={setShowCompose}
        onSend={onSend}
        isSaving={isSaving}
      />
    </>
  );
}
