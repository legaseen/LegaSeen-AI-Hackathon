import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import archiveSheet from "@/assets/archive-contact-sheet.jpg";
import { supabase } from "@/lib/supabase";
import { displayName, useSession } from "@/lib/auth";

export function ArchiveShell({ children, vaultId }: { children: React.ReactNode; vaultId?: string }) {
  const { session } = useSession();
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b-2 border-gold bg-navy text-ivory shadow-sm">
        <div className="mx-auto flex h-18 max-w-7xl items-center gap-7 px-5 sm:px-8">
          <Link to="/" className="shrink-0 cursor-pointer" aria-label="LegaSeen home">
            <img src="/legaseen-logo.png" alt="LegaSeen" width={1200} height={300} className="h-10 w-auto object-contain" />
          </Link>
          <nav className="hidden flex-1 items-center gap-7 md:flex" aria-label="Main navigation">
            <Link to="/" className={navClass} activeProps={{ className: "border-gold text-gold" }} activeOptions={{ exact: true }}>
              Archive
            </Link>
            {vaultId && (
              <>
                <Link to="/vault/$vaultId" params={{ vaultId }} className={navClass} activeProps={{ className: "border-gold text-gold" }}>
                  Archive Vault
                </Link>
                <Link to="/gallery/$vaultId" params={{ vaultId }} className={navClass} activeProps={{ className: "border-gold text-gold" }}>
                  Gallery
                </Link>
              </>
            )}
          </nav>
          {session && (
            <div className="ml-auto hidden items-center gap-5 sm:flex">
              <div className="flex items-center gap-3 border-l border-ivory/15 pl-5">
                <span className="relative grid size-10 place-items-center rounded-full border border-gold/60 bg-ivory/10 font-display text-base font-bold text-gold">
                  {displayName(session).slice(0, 1).toUpperCase()}
                  <span aria-hidden className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-navy bg-green-500" />
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-semibold capitalize text-ivory">{displayName(session)}</span>
                  <span className="block text-[0.68rem] text-gold">Primary Trustee</span>
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={signOut} className="border-ivory/25 bg-transparent text-ivory hover:bg-ivory/10 hover:text-ivory">
                <LogOut /> Sign out
              </Button>
            </div>
          )}
          <Button variant="ghost" size="icon" className="ml-auto text-gold md:hidden" aria-label="Menu">
            <Menu />
          </Button>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-16 border-t-2 border-gold bg-navy text-ivory">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-9 text-[0.62rem] uppercase tracking-[0.14em] sm:flex-row sm:items-end sm:justify-between sm:px-8">
          <div>
            <p className="font-bold text-gold">LegaSeen Archive Trust</p>
            <p className="mt-2 text-ivory/55">Private family archives · Preserving living voices</p>
          </div>
          <p className="text-ivory/55">© 2026 LegaSeen. All rights strictly reserved.</p>
        </div>
      </footer>
    </div>
  );
}

const navClass =
  "cursor-pointer border-b-2 border-transparent py-6 text-[0.68rem] font-bold uppercase tracking-[0.15em] text-ivory/75 transition hover:border-gold hover:text-gold";

/** Placeholder art from the contact sheet, used only where we have no real image. */
export function ArchivePhoto({ crop, alt }: { crop: number; alt: string }) {
  return (
    <div className={`archive-crop archive-crop-${crop}`}>
      <img src={archiveSheet} alt={alt} loading="lazy" width={1536} height={1024} />
    </div>
  );
}

/** A real frame or photo, falling back to the contact sheet while it loads or if missing. */
export function Still({ src, crop, alt, className }: { src: string | null | undefined; crop: number; alt: string; className?: string }) {
  if (!src) return <ArchivePhoto crop={crop} alt={alt} />;
  return (
    <div className={`relative aspect-video overflow-hidden bg-navy ${className ?? ""}`}>
      <img src={src} alt={alt} loading="lazy" className="absolute inset-0 size-full object-cover" />
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return <p className="eyebrow py-10 text-center">{label}</p>;
}

export const metadata = (title: string, description: string) => ({
  meta: [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ],
});
