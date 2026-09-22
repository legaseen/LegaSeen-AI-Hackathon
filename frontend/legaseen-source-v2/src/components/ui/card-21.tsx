import * as React from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

interface DestinationCardProps extends React.HTMLAttributes<HTMLDivElement> {
  imageUrl: string | null;
  eyebrow?: string;
  title: string;
  stats: string;
  tags?: string[];
  cta?: string;
  /** Router link props, so navigation stays client-side (the original used a plain <a href>). */
  link: LinkProps;
  /** HSL triple, e.g. "228 70% 20%" — drives the gradient, the panel and the hover glow. */
  themeColor: string;
  /**
   * "cover": the original full-bleed look (crops the image to the card).
   * "frame": the whole image, uncropped, in a 16:9 region with a blurred fill
   * behind it, text below — for video stills, where cropping cuts faces.
   */
  layout?: "cover" | "frame";
}

const DestinationCard = React.forwardRef<HTMLDivElement, DestinationCardProps>(
  ({ className, imageUrl, eyebrow, title, stats, tags, cta = "Explore now", link, themeColor, layout = "cover", ...props }, ref) => {
    const glow = "0 0 40px -15px hsl(var(--theme-color) / 0.5)";
    const body = (
      <>
        {eyebrow && <p className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.18em] text-white/70">{eyebrow}</p>}
        <h3 className="font-display text-2xl font-bold leading-tight tracking-tight">{title}</h3>
        <p className="mt-1.5 text-sm font-medium text-white/80">{stats}</p>
        {tags && tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span key={t} className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-white/85">#{t}</span>
            ))}
          </div>
        )}
        {/* Solid gold on the theme colour: readable on any still, unlike a theme-on-theme glass bar. */}
        <div className="mt-6 flex items-center justify-between rounded-lg bg-gold px-4 py-3 text-navy transition-colors duration-300 group-hover:bg-gold-strong">
          <span className="text-sm font-bold tracking-wide">{cta}</span>
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
        </div>
      </>
    );

    return (
      <div ref={ref} style={{ "--theme-color": themeColor } as React.CSSProperties} className={cn("group h-full w-full", className)} {...props}>
        {layout === "frame" ? (
          <Link
            {...link}
            aria-label={`Open ${title}`}
            className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl transition-all duration-500 ease-in-out group-hover:-translate-y-1 group-hover:shadow-[0_0_60px_-15px_hsl(var(--theme-color)/0.7)]"
            style={{ background: "hsl(var(--theme-color))", boxShadow: glow }}
          >
            <div className="relative aspect-video w-full overflow-hidden">
              {imageUrl ? (
                <>
                  <div aria-hidden className="absolute inset-0 scale-110 bg-cover bg-center opacity-70 blur-xl" style={{ backgroundImage: `url(${imageUrl})` }} />
                  <img src={imageUrl} alt="" className="relative size-full object-contain transition-transform duration-500 ease-in-out group-hover:scale-[1.04]" />
                </>
              ) : (
                <div className="grid size-full place-items-center text-white/40">
                  <span className="font-display text-4xl italic">{title.slice(0, 1)}</span>
                </div>
              )}
              <div aria-hidden className="absolute inset-x-0 bottom-0 h-10" style={{ background: "linear-gradient(to top, hsl(var(--theme-color)), transparent)" }} />
            </div>
            <div className="flex flex-1 flex-col p-5 text-white">{body}</div>
          </Link>
        ) : (
          <Link
            {...link}
            aria-label={`Open ${title}`}
            className="relative block h-full w-full overflow-hidden rounded-2xl transition-all duration-500 ease-in-out group-hover:scale-[1.03] group-hover:shadow-[0_0_60px_-15px_hsl(var(--theme-color)/0.6)]"
            style={{ boxShadow: glow }}
          >
            <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 ease-in-out group-hover:scale-110"
                 style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : { background: "hsl(var(--theme-color))" }} />
            <div className="absolute inset-0" style={{ background: "linear-gradient(to top, hsl(var(--theme-color) / 0.92), hsl(var(--theme-color) / 0.55) 35%, transparent 65%)" }} />
            <div className="relative flex h-full flex-col justify-end p-6 text-white">{body}</div>
          </Link>
        )}
      </div>
    );
  },
);
DestinationCard.displayName = "DestinationCard";

export { DestinationCard };
