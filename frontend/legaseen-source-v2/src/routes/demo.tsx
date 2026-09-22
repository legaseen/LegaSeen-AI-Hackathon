import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ArchiveShell, LoadingBlock, metadata } from "@/components/archive-shell";
import { enterDemo } from "@/lib/demo";

export const Route = createFileRoute("/demo")({
  ssr: false,
  head: () => metadata("Guest entrance — LegaSeen", "Open the family archive as a guest, without signing in."),
  component: DemoPage,
});

/**
 * The guest entrance. Signs the visitor in as the walkthrough custodian and
 * hands them straight to the archive, so anyone following this link never meets
 * the password form.
 *
 * A failure stops here and says so rather than falling through to sign-in:
 * being quietly dropped on a login page is the one outcome this route exists to
 * prevent, and a visitor who sees it has no way of knowing the link was meant
 * to skip it.
 */
function DemoPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    enterDemo().then((message) => {
      if (cancelled) return;
      if (message) return setError(message);
      navigate({ to: "/" });
    });
    return () => { cancelled = true; };
  }, [navigate]);

  if (error) {
    return (
      <ArchiveShell>
        <div className="mx-auto mt-16 max-w-md border border-gold bg-secondary px-5 py-4 text-sm text-navy">
          <p className="font-bold">The guest entrance didn&apos;t open.</p>
          <p className="mt-1">{error}</p>
          <a href="/" className="mt-3 inline-block font-bold text-primary underline">Go to the sign-in page</a>
        </div>
      </ArchiveShell>
    );
  }

  return <ArchiveShell><LoadingBlock label="Opening the archive…" /></ArchiveShell>;
}
