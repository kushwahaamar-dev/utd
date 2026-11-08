import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ink";
export type ButtonSize = "sm" | "md" | "lg";

// max-w-full: a label longer than its row (a long translation on a phone) wraps instead of pushing the page sideways.
// Disabled looks the same in every variant, so a disabled primary stops reading as the next thing to press.
const base =
  "inline-flex max-w-full select-none items-center justify-center gap-2 text-center rounded-full border font-body font-medium leading-tight no-underline transition-[background-color,border-color,color,filter] duration-150 " +
  "disabled:cursor-not-allowed disabled:border-rule disabled:bg-sunken disabled:text-muted" +
  "aria-disabled:cursor-not-allowed aria-disabled:border-rule aria-disabled:bg-sunken aria-disabled:text-muted";

const variants: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-ink text-paper hover:bg-ink/85",
  secondary: "border-line bg-surface text-ink hover:border-ink hover:bg-sunken aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper",
  ghost: "border-transparent bg-transparent text-ink hover:bg-sunken aria-pressed:bg-ink aria-pressed:text-paper",
  danger: "border-transparent bg-tomato text-on-color hover:brightness-95",
  ink: "border-transparent bg-ink text-paper hover:bg-ink/85",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-sm [@media(pointer:coarse)]:min-h-11",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-13 px-6 text-base",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cx(base, variants[variant], sizes[size], className);
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

/** A link that looks like a button (navigation, not an action). */
export function ButtonLink({ variant, size, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
