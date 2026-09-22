import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Contextual "← Back to …" link at the top of inner pages. */
export function BackLink({ label, link }: { label: string; link: LinkProps }) {
  return (
    <Link {...link} className="group inline-flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.15em] text-muted-foreground transition hover:text-gold-strong">
      <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" /> Back to {label}
    </Link>
  );
}

/** Previous / next pager: "Recording 2 of 5", "Chapter 3 of 8". */
export function Pager({ label, index, total, onPrev, onNext, prevLink, nextLink, compact }: {
  label: string; index: number; total: number;
  onPrev?: () => void; onNext?: () => void;
  prevLink?: LinkProps | null; nextLink?: LinkProps | null;
  compact?: boolean;
}) {
  const hasPrev = prevLink != null || (onPrev != null && index > 0);
  const hasNext = nextLink != null || (onNext != null && index < total - 1);
  const btn = "border-border text-navy hover:bg-secondary disabled:opacity-35";
  return (
    <div className="inline-flex items-center gap-2">
      {prevLink
        ? <Button asChild variant="outline" size={compact ? "icon" : "sm"} className={btn}><Link {...prevLink} aria-label={`Previous ${label}`}><ChevronLeft />{!compact && "Previous"}</Link></Button>
        : <Button variant="outline" size={compact ? "icon" : "sm"} className={btn} onClick={onPrev} disabled={!hasPrev} aria-label={`Previous ${label}`}><ChevronLeft />{!compact && "Previous"}</Button>}
      <span className="min-w-[7rem] text-center text-[0.68rem] font-bold uppercase tracking-[0.13em] text-muted-foreground">
        {label} {total ? index + 1 : 0} of {total}
      </span>
      {nextLink
        ? <Button asChild variant="outline" size={compact ? "icon" : "sm"} className={btn}><Link {...nextLink} aria-label={`Next ${label}`}>{!compact && "Next"}<ChevronRight /></Link></Button>
        : <Button variant="outline" size={compact ? "icon" : "sm"} className={btn} onClick={onNext} disabled={!hasNext} aria-label={`Next ${label}`}>{!compact && "Next"}<ChevronRight /></Button>}
    </div>
  );
}
