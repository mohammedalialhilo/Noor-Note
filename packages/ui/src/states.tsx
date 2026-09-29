"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { classes } from "./utils";

export type SidebarProps = ComponentPropsWithRef<"aside"> & { side?: "left" | "right" };

export function Sidebar({ side = "left", className, ...props }: SidebarProps) {
  return <aside {...props} className={classes("nn-sidebar", `nn-sidebar--${side}`, className)} />;
}

export type LoadingIndicatorProps = ComponentPropsWithRef<"div"> & { label?: string };

export function LoadingIndicator({ label = "Loading…", className, ...props }: LoadingIndicatorProps) {
  return <div {...props} role="status" className={classes("nn-loading", className)}><span aria-hidden="true" className="nn-loading__spinner" /><span>{label}</span></div>;
}

export type EmptyStateProps = ComponentPropsWithRef<"div"> & {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ title, description, icon, action, className, ...props }: EmptyStateProps) {
  return <div {...props} className={classes("nn-state", className)}>
    {icon && <span className="nn-state__icon" aria-hidden="true">{icon}</span>}
    <h2 className="nn-state__title">{title}</h2>
    {description && <p className="nn-state__description">{description}</p>}
    {action && <div className="nn-state__action">{action}</div>}
  </div>;
}

export type ErrorStateProps = ComponentPropsWithRef<"div"> & {
  title?: string;
  message: string;
  action?: ReactNode;
};

export function ErrorState({ title = "Something went wrong", message, action, className, ...props }: ErrorStateProps) {
  return <div {...props} role="alert" className={classes("nn-state", "nn-state--error", className)}>
    <h2 className="nn-state__title">{title}</h2>
    <p className="nn-state__description">{message}</p>
    {action && <div className="nn-state__action">{action}</div>}
  </div>;
}
