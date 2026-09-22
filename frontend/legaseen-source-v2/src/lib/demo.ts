import { supabase } from "./supabase";

/**
 * The guest entrance used for walkthroughs and judging.
 *
 * The credentials arrive as build-time `VITE_` variables, which Vite inlines
 * into the client bundle — so they are public, exactly as the anon key is.
 * That is the honest trade for a link that opens the archive with no sign-in:
 * anything the browser is told to do, a reader of the bundle can do too. It is
 * safe here only because the account carries no special power. It is an
 * ordinary member, held to the same row-level security as everyone else —
 * editor on the one vault prepared for the walkthrough, and invisible to every
 * other family's archive in the project.
 */
const EMAIL = import.meta.env["VITE_DEMO_EMAIL"] as string | undefined;
const PASSWORD = import.meta.env["VITE_DEMO_PASSWORD"] as string | undefined;

/** Whether this build shipped a guest account, so the entrance can stay hidden when it didn't. */
export const demoConfigured = Boolean(EMAIL && PASSWORD);

/**
 * Sign in as the guest custodian. Resolves to null once the session is in
 * place, or to a message worth showing a visitor.
 *
 * A session belonging to someone else is signed out first: a guest following
 * this link wants the prepared archive, not whichever account a previous
 * visitor happened to leave open on the same laptop.
 */
export async function enterDemo(): Promise<string | null> {
  if (!EMAIL || !PASSWORD) return "The guest entrance isn't configured for this build.";

  const { data } = await supabase.auth.getSession();
  if (data.session?.user.email === EMAIL) return null;
  if (data.session) await supabase.auth.signOut();

  const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  return error ? error.message : null;
}
