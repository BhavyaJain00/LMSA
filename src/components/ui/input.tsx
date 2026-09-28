import type { ComponentProps, InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-lg border border-border-strong bg-surface-1 text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60 disabled:bg-surface-2 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25";

export interface InputProps extends ComponentProps<"input"> {
  invalid?: boolean;
  leftAddon?: ReactNode;
  rightAddon?: ReactNode;
}

export function Input({ className, invalid, leftAddon, rightAddon, ...props }: InputProps) {
  if (leftAddon || rightAddon) {
    return (
      <div className="relative flex items-center">
        {leftAddon && <span className="pointer-events-none absolute left-3 text-ink-faint">{leftAddon}</span>}
        <input
          className={cn(fieldBase, "h-9.5 px-3 text-sm", leftAddon && "pl-9", rightAddon && "pr-9", className)}
          aria-invalid={invalid || undefined}
          {...props}
        />
        {rightAddon && <span className="absolute right-3 text-ink-faint">{rightAddon}</span>}
      </div>
    );
  }
  return <input className={cn(fieldBase, "h-9.5 px-3 text-sm", className)} aria-invalid={invalid || undefined} {...props} />;
}

export interface TextareaProps extends ComponentProps<"textarea"> {
  invalid?: boolean;
}

export function Textarea({ className, invalid, rows = 4, ...props }: TextareaProps) {
  return <textarea rows={rows} className={cn(fieldBase, "px-3 py-2 text-sm leading-relaxed", className)} aria-invalid={invalid || undefined} {...props} />;
}

export interface SelectProps extends ComponentProps<"select"> {
  invalid?: boolean;
  options?: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export function Select({ className, invalid, options, placeholder, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(fieldBase, "h-9.5 appearance-none pl-3 pr-9 text-sm", className)}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {placeholder && (
          <option value="" disabled={props.required}>
            {placeholder}
          </option>
        )}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ className, label, description, id, ...props }: CheckboxProps) {
  const inputId = id ?? props.name;
  const box = (
    <input
      id={inputId}
      type="checkbox"
      className={cn("mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border-strong accent-accent", className)}
      {...props}
    />
  );
  if (!label) return box;
  return (
    <label htmlFor={inputId} className="flex cursor-pointer items-start gap-2.5 text-sm">
      {box}
      <span>
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: ReactNode;
  description?: ReactNode;
}

/** A toggle switch built on a hidden checkbox (works in plain forms and with server actions). */
export function Switch({ className, label, description, id, ...props }: SwitchProps) {
  const inputId = id ?? props.name;
  return (
    <label htmlFor={inputId} className={cn("flex cursor-pointer items-start justify-between gap-4 text-sm", className)}>
      {label && (
        <span>
          <span className="font-medium text-ink">{label}</span>
          {description && <span className="block text-xs text-ink-muted">{description}</span>}
        </span>
      )}
      <span className="relative inline-flex shrink-0">
        <input id={inputId} type="checkbox" className="peer sr-only" {...props} />
        <span className="h-5.5 w-10 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 peer-disabled:opacity-50" />
        <span className="absolute left-0.5 top-0.5 size-4.5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4.5" />
      </span>
    </label>
  );
}

export function Label({ className, children, required, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn("mb-1.5 block text-sm font-medium text-ink", className)} {...props}>
      {children}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </label>
  );
}

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error wrapper. */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-0", className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : hint ? <p className="mt-1.5 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
      {message}
    </div>
  );
}

export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  icon,
  disabled,
}: {
  name: string;
  value: string;
  checked?: boolean;
  onChange?: (value: string) => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
        checked ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-border hover:bg-surface-2",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange?.(value)} className="sr-only" disabled={disabled} />
      {icon && <span className="mt-0.5 text-ink-muted">{icon}</span>}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description && <span className="block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}
