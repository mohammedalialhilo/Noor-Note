"use client";

import { useId } from "react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { classes } from "./utils";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ className, variant = "secondary", size = "md", type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} className={classes("nn-button", `nn-button--${variant}`, `nn-button--${size}`, className)} />;
}

export type IconButtonProps = Omit<ButtonProps, "children" | "aria-label"> & {
  icon: ReactNode;
  "aria-label": string;
};

export function IconButton({ icon, className, variant = "ghost", size = "md", ...props }: IconButtonProps) {
  return <Button {...props} variant={variant} size={size} className={classes("nn-icon-button", className)}><span aria-hidden="true" className="nn-icon-button__icon">{icon}</span></Button>;
}

type FieldProps = {
  label?: string;
  hint?: string;
  error?: string;
};

export type InputProps = Omit<ComponentPropsWithRef<"input">, "size"> & FieldProps;

export function Input({ id, label, hint, error, className, "aria-describedby": describedBy, ...props }: InputProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const descriptionIds = [describedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;
  return <div className="nn-field">
    {label && <label className="nn-field__label" htmlFor={fieldId}>{label}</label>}
    <input {...props} id={fieldId} className={classes("nn-input", className)} aria-invalid={Boolean(error) || undefined} aria-describedby={descriptionIds} />
    {hint && <span id={hintId} className="nn-field__hint">{hint}</span>}
    {error && <span id={errorId} className="nn-field__error">{error}</span>}
  </div>;
}

export type SelectProps = ComponentPropsWithRef<"select"> & FieldProps;

export function Select({ id, label, hint, error, className, "aria-describedby": describedBy, children, ...props }: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const descriptionIds = [describedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;
  return <div className="nn-field">
    {label && <label className="nn-field__label" htmlFor={fieldId}>{label}</label>}
    <select {...props} id={fieldId} className={classes("nn-select", className)} aria-invalid={Boolean(error) || undefined} aria-describedby={descriptionIds}>{children}</select>
    {hint && <span id={hintId} className="nn-field__hint">{hint}</span>}
    {error && <span id={errorId} className="nn-field__error">{error}</span>}
  </div>;
}
