import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold cursor-pointer transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-soft hover:brightness-105",
        destructive: "bg-destructive text-destructive-foreground shadow-soft hover:brightness-110",
        outline:
          "border border-border bg-surface shadow-soft hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        hero: "bg-foreground text-background shadow-lift hover:bg-foreground/90",
        success: "bg-success text-success-foreground hover:brightness-110",
        info: "bg-info text-info-foreground hover:brightness-110",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-12 rounded-xl px-6 text-base",
        icon: "h-10 w-10",
        "icon-sm": "h-9 w-9 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * An action that returns a promise (e.g. `() => save()`) keeps the button busy until it ends:
   * a spinner in place of its icon, and a second tap does nothing (no double saves).
   */
  onClick?: ((event: React.MouseEvent<HTMLButtonElement>) => unknown) | undefined;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, onClick, disabled, children, ...props }, ref) => {
    const [busy, setBusy] = React.useState(false);
    const running = React.useRef(false);
    const handleClick = onClick
      ? (event: React.MouseEvent<HTMLButtonElement>) => {
          if (running.current) {
            event.preventDefault();
            return;
          }
          const result = onClick(event);
          if (result && typeof (result as Promise<unknown>).then === "function") {
            running.current = true;
            setBusy(true);
            const done = () => {
              running.current = false;
              setBusy(false);
            };
            (result as Promise<unknown>).then(done, done);
          }
        }
      : undefined;
    if (asChild)
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          onClick={handleClick}
          {...props}
        >
          {children}
        </Slot>
      );
    // A caller that shows its own spinner disables the button itself: no second spinner then.
    const spinner = busy && !disabled;
    return (
      <button
        className={cn(
          buttonVariants({ variant, size, className }),
          busy && "cursor-wait",
          spinner && "[&>svg:not([data-busy])]:hidden",
        )}
        ref={ref}
        onClick={handleClick}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...props}
      >
        {spinner ? <Loader2 data-busy className="animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
