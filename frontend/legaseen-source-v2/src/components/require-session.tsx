import type { ReactNode } from "react";

import { LoadingBlock } from "@/components/archive-shell";
import { LoginPage } from "@/components/ui/sign-in-page";
import { useSession } from "@/lib/auth";

/** Renders the sign-in page for signed-out visitors, so deep links don't look like a permission error. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  if (!ready) return <LoadingBlock label="Opening the archive…" />;
  if (!session) return <LoginPage />;
  return <>{children}</>;
}
