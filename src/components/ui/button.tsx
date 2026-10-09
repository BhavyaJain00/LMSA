import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "subtle" | "link" | "inverse" | "inverse-outline";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg shadow-sm hover:brightness-110 active:brightness-95 disabled:hover:brightness-100",
  /** Second-level action next to a primary one: accent tint, never black. */
  secondary: "bg-accent/10 text-accent hover:bg-accent/15",
  outline: "border border-border-strong bg-surface-1 text-ink hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  subtle: "bg-surface-2 text-ink hover:bg-surface-3",
  danger: "bg-danger-fill text-white hover:brightness-110",
  link: "text-accent underline-offset-4 hover:underline px-0 h-auto",
  /** On an accent-coloured band (CTA sections): light button with accent text. */
  inverse: "bg-accent-fg text-(--accent) shadow-sm hover:bg-accent-fg/90",
  /** Outline companion of `inverse` on an accent-coloured band. */
  "inverse-outline": "border border-accent-fg/70 text-accent-fg hover:bg-accent-fg/10",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-9.5 px-4 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-base gap-2 rounded-xl",
  icon: "size-9 rounded-lg",
  "icon-sm": "size-7 rounded-md",
};

/** Sizes below 44px get an invisible 44px touch hit area (`.tap-target` in globals.css). */
const smallSizes: ReadonlySet<ButtonSize> = new Set(["xs", "sm", "md", "icon", "icon-sm"]);

export function buttonClasses(opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  const { variant = "primary", size = "md", className } = opts;
  return cn(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-[background-color,filter,opacity,transform] duration-150 select-none",
    "disabled:opacity-50 disabled:pointer-events-none",
    variants[variant],
    sizes[size],
    smallSizes.has(size) && "tap-target",
    className,
  );
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  leftIcon,
  rightIcon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

export interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  prefetch?: boolean;
  target?: string;
  rel?: string;
  title?: string;
  "aria-label"?: string;
}

export function ButtonLink({ href, variant = "primary", size = "md", className, children, leftIcon, rightIcon, ...props }: ButtonLinkProps) {
  const external = /^https?:\/\//.test(href);
  const classes = buttonClasses({ variant, size, className });
  if (external) {
    return (
      <a href={href} className={classes} target="_blank" rel="noopener noreferrer" {...props}>
        {leftIcon}
        {children}
        {rightIcon}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...props}>
      {leftIcon}
      {children}
      {rightIcon}
    </Link>
  );
}

/** Small icon-only button with an accessible label. */
export function IconButton({
  label,
  className,
  size = "icon",
  variant = "ghost",
  children,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <Button aria-label={label} title={label} size={size} variant={variant} className={className} {...props}>
      {children}
    </Button>
  );
}
