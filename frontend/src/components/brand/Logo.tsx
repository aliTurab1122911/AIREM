import type { CSSProperties } from "react";

export type LogoVariant = "mark" | "wordmark" | "stacked";
export type LogoTone = "dark" | "light";

interface LogoProps {
  variant?: LogoVariant;
  tone?: LogoTone;
  /** Rendered width; height follows the source artwork's aspect ratio. */
  size?: number | string;
  alt?: string;
  decorative?: boolean;
  className?: string;
}

const sources: Record<LogoTone, Record<LogoVariant, string>> = {
  dark: {
    mark: "/brand/airem-mark-dark.png",
    wordmark: "/brand/airem-wordmark-dark.png",
    stacked: "/brand/airem-stacked-dark.png",
  },
  light: {
    mark: "/brand/airem-mark-light.png",
    wordmark: "/brand/airem-wordmark-light.png",
    stacked: "/brand/airem-stacked-light.png",
  },
};

const defaultSizes: Record<LogoVariant, string> = {
  mark: "2rem",
  wordmark: "7.5rem",
  stacked: "9rem",
};

const aspectRatios: Record<LogoVariant, string> = {
  mark: "198 / 119",
  wordmark: "201 / 31",
  stacked: "202 / 154",
};

export function Logo({
  variant = "wordmark",
  tone = "dark",
  size,
  alt = "Airem",
  decorative = false,
  className,
}: LogoProps) {
  const style = {
    "--logo-width":
      typeof size === "number" ? `${size}px` : (size ?? defaultSizes[variant]),
    aspectRatio: aspectRatios[variant],
  } as CSSProperties;

  return (
    <img
      className={["brand-logo", `brand-logo--${variant}`, className]
        .filter(Boolean)
        .join(" ")}
      src={sources[tone][variant]}
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
      style={style}
    />
  );
}
