"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { registerConfirmHost, type ConfirmOptions } from "@/lib/feedback";

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * Renders confirmAction() requests as a dialog. Mounted once in
 * Providers. A new request while one is open cancels the old one.
 */
export function ConfirmHost() {
  const [req, setReq] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
  const current = useRef<Pending | null>(null);

  useEffect(
    () =>
      registerConfirmHost((next) => {
        current.current?.resolve(false);
        current.current = next;
        setReq(next);
        setOpen(true);
      }),
    [],
  );

  function settle(ok: boolean) {
    current.current?.resolve(ok);
    current.current = null;
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    >
      {req ? (
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{req.title}</DialogTitle>
            {req.description ? <DialogDescription>{req.description}</DialogDescription> : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {req.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              autoFocus
              variant={req.destructive ? "destructive" : "default"}
              className={req.destructive ? "bg-danger text-white hover:bg-danger/90" : undefined}
              onClick={() => settle(true)}
            >
              {req.confirmLabel ?? "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
