"use client";

import { useRef, type ComponentProps, type ComponentPropsWithRef, type ReactElement, type ReactNode } from "react";
import {
  ContextMenu as ContextMenuPrimitive,
  Dialog as DialogPrimitive,
  DropdownMenu as DropdownMenuPrimitive,
  Tabs as TabsPrimitive,
  Toast as ToastPrimitive,
  Tooltip as TooltipPrimitive,
} from "radix-ui";
import { classes } from "./utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Content>) {
  return <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content {...props} sideOffset={sideOffset} className={classes("nn-menu", className)} /></DropdownMenuPrimitive.Portal>;
}

export function DropdownMenuItem({ className, ...props }: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item {...props} className={classes("nn-menu__item", className)} />;
}

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label {...props} className={classes("nn-menu__label", className)} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator {...props} className={classes("nn-menu__separator", className)} />;
}

export const Menu = DropdownMenu;
export const MenuTrigger = DropdownMenuTrigger;
export const MenuContent = DropdownMenuContent;
export const MenuItem = DropdownMenuItem;
export const MenuLabel = DropdownMenuLabel;
export const MenuSeparator = DropdownMenuSeparator;

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({ className, ...props }: ComponentPropsWithRef<typeof ContextMenuPrimitive.Content>) {
  return <ContextMenuPrimitive.Portal><ContextMenuPrimitive.Content {...props} className={classes("nn-menu", className)} /></ContextMenuPrimitive.Portal>;
}

export function ContextMenuItem({ className, ...props }: ComponentPropsWithRef<typeof ContextMenuPrimitive.Item>) {
  return <ContextMenuPrimitive.Item {...props} className={classes("nn-menu__item", className)} />;
}

export function ContextMenuLabel({ className, ...props }: ComponentPropsWithRef<typeof ContextMenuPrimitive.Label>) {
  return <ContextMenuPrimitive.Label {...props} className={classes("nn-menu__label", className)} />;
}

export function ContextMenuSeparator({ className, ...props }: ComponentPropsWithRef<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator {...props} className={classes("nn-menu__separator", className)} />;
}

export const DialogRoot = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({ className, children, onOpenAutoFocus, onCloseAutoFocus, ...props }: ComponentPropsWithRef<typeof DialogPrimitive.Content>) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="nn-dialog__overlay" />
    <DialogPrimitive.Content {...props} className={classes("nn-dialog", className)} onOpenAutoFocus={(event) => { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; onOpenAutoFocus?.(event); }} onCloseAutoFocus={(event) => { onCloseAutoFocus?.(event); if (!event.defaultPrevented && previousFocus.current?.isConnected) { event.preventDefault(); previousFocus.current.focus(); } }}>
      {children}
      <DialogPrimitive.Close className="nn-dialog__close" aria-label="Close dialog">×</DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}

export type DialogProps = ComponentProps<typeof DialogPrimitive.Root> & {
  title: string;
  description?: string;
  trigger?: ReactElement;
  children: ReactNode;
  contentClassName?: string;
};

export function Dialog({ title, description, trigger, children, contentClassName, ...props }: DialogProps) {
  return <DialogPrimitive.Root {...props}>
    {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
    <DialogContent className={contentClassName} {...(description ? {} : { "aria-describedby": undefined })}>
      <DialogPrimitive.Title className="nn-dialog__title">{title}</DialogPrimitive.Title>
      {description && <DialogPrimitive.Description className="nn-dialog__description">{description}</DialogPrimitive.Description>}
      {children}
    </DialogContent>
  </DialogPrimitive.Root>;
}

export type TooltipProps = ComponentProps<typeof TooltipPrimitive.Root> & {
  content: ReactNode;
  children: ReactElement;
  side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
};

export function Tooltip({ content, children, side = "top", ...props }: TooltipProps) {
  return <TooltipPrimitive.Provider delayDuration={350}>
    <TooltipPrimitive.Root {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal><TooltipPrimitive.Content side={side} sideOffset={7} className="nn-tooltip">{content}</TooltipPrimitive.Content></TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  </TooltipPrimitive.Provider>;
}

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentPropsWithRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List {...props} className={classes("nn-tabs__list", className)} />;
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithRef<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger {...props} className={classes("nn-tabs__trigger", className)} />;
}

export function TabsContent({ className, ...props }: ComponentPropsWithRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content {...props} className={classes("nn-tabs__content", className)} />;
}

export function ToastProvider({ children, ...props }: ComponentProps<typeof ToastPrimitive.Provider>) {
  return <ToastPrimitive.Provider {...props}>{children}<ToastPrimitive.Viewport className="nn-toast-viewport" label="Notifications" /></ToastPrimitive.Provider>;
}

export type ToastProps = Omit<ComponentPropsWithRef<typeof ToastPrimitive.Root>, "title"> & {
  title: string;
  description?: string;
  variant?: "default" | "success" | "error";
};

export function Toast({ title, description, variant = "default", className, ...props }: ToastProps) {
  return <ToastPrimitive.Root {...props} className={classes("nn-toast", `nn-toast--${variant}`, className)}>
    <div className="nn-toast__body"><ToastPrimitive.Title className="nn-toast__title">{title}</ToastPrimitive.Title>
      {description && <ToastPrimitive.Description className="nn-toast__description">{description}</ToastPrimitive.Description>}
    </div>
    <ToastPrimitive.Close className="nn-toast__close" aria-label="Dismiss notification">×</ToastPrimitive.Close>
  </ToastPrimitive.Root>;
}
