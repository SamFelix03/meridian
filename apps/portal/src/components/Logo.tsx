import { Link } from "react-router-dom";
import { cn } from "../lib/utils";

/**
 * Logo display sizes — change these to adjust logo scale app-wide.
 *
 * - `header`  → navbar (AppNavbar)
 * - `landing` → role chooser hero (RoleChooser)
 */
export const LOGO_SIZES = {
  header: "h-11 w-auto md:h-12",
  landing: "h-16 w-auto md:h-[4.75rem]",
} as const;

export type LogoSize = keyof typeof LOGO_SIZES;

interface LogoProps {
  to?: string | null;
  size?: LogoSize;
  className?: string;
  imageClassName?: string;
}

export function Logo({
  to = "/",
  size = "header",
  className,
  imageClassName,
}: LogoProps) {
  const img = (
    <img
      src="/logo.png"
      alt="Meridian"
      className={cn(LOGO_SIZES[size], imageClassName)}
      width={200}
      height={48}
    />
  );

  if (to != null) {
    return (
      <Link
        to={to}
        className={cn("inline-flex shrink-0 transition-transform hover:scale-[1.02]", className)}
        aria-label="Meridian home"
      >
        {img}
      </Link>
    );
  }

  return <span className={cn("inline-flex shrink-0", className)}>{img}</span>;
}
