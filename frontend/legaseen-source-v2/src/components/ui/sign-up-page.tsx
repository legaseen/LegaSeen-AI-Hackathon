import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Eye, EyeOff, MailCheck } from "lucide-react";

import { supabase } from "@/lib/supabase";

/** Account creation. Vault access is granted separately by a vault's custodian. */
export function SignUpPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [existing, setExisting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setExisting(false);
    if (busy) return;                       // guard a double submit
    if (displayName.trim().length < 2) return setErr("Please enter the name your family knows you by.");
    if (password.length < 8) return setErr("Please choose a password of at least 8 characters.");
    if (password !== confirm) return setErr("Those two passwords don't match.");

    setBusy(true);
    const address = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: address,
      password,
      options: {
        data: { display_name: displayName.trim() },
        ...(typeof window !== "undefined" ? { emailRedirectTo: window.location.origin } : {}),
      },
    });
    setBusy(false);
    if (error) {
      // Some projects report this directly rather than obfuscating it.
      if (/already registered|already exists|User already/i.test(error.message)) return setExisting(true);
      return setErr(error.message);
    }
    // Supabase hides whether an email is taken: it answers with no error and a
    // throwaway user whose `identities` array is empty. That is the only signal
    // that the address already has an account — without it the person would sit
    // waiting for a confirmation mail that never arrives.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return setExisting(true);
    }
    // With email confirmation on, no session comes back until the link is clicked.
    if (!data.session) setSent(true);
  }

  const field =
    "w-full rounded-xl border border-input bg-background px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-gold";

  return (
    <div className="flex min-h-screen w-full bg-gradient-to-br from-navy via-primary to-navy">
      <div className="relative hidden flex-1 overflow-hidden lg:block">
        <img src="/login-portrait.jpg" alt="An elder recounting a story in her study" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/85 via-navy/10 to-navy/20" />
        <img src="/legaseen-logo.png" alt="LegaSeen" width={1200} height={300} className="absolute left-8 top-8 h-11 w-auto drop-shadow" />
        <div className="absolute inset-x-8 bottom-10 text-ivory">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-gold">Private family custody</p>
          <p className="mt-3 max-w-md font-display text-2xl italic leading-snug">&ldquo;The voice keeps what the picture alone cannot tell.&rdquo;</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-card">
        <div className="w-full max-w-md p-8">
          <img src="/legaseen-logo.png" alt="LegaSeen" width={1200} height={300} className="mb-8 h-10 w-auto lg:hidden" />

          {sent ? (
            <div>
              <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary"><MailCheck className="size-6" /></span>
              <h1 className="mt-5 font-display text-3xl font-bold text-navy">Check your email</h1>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                We&apos;ve sent a confirmation link to <span className="font-semibold text-navy">{email.trim()}</span>.
                Open it on this device and your account is ready.
              </p>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                Creating an account doesn&apos;t open a vault by itself — a vault&apos;s custodian adds you to theirs,
                or you can commission a new vault once you&apos;re in.
              </p>
              <Link to="/" className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-gold-strong">
                <ArrowLeft className="size-4" /> Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h1 className="mb-2 font-display text-3xl font-bold text-navy">Create your account</h1>
                <p className="text-muted-foreground">
                  Already have one?{" "}
                  <Link to="/" className="font-medium text-primary hover:text-gold-strong">Sign in</Link>
                </p>
              </div>

              {existing && (
                <p role="alert" className="mb-6 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  An account already exists with this email address.{" "}
                  <Link to="/" className="font-semibold underline">Sign in instead</Link>
                </p>
              )}
              {err && <p role="alert" className="mb-6 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{err}</p>}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="name" className="mb-2 block text-sm font-medium text-foreground">Your name</label>
                  <input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                         placeholder="The name your family knows you by" autoComplete="name" className={field} required />
                </div>
                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground">Email address</label>
                  <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                         placeholder="Email address" autoComplete="email" className={field} required />
                </div>
                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-medium text-foreground">Password</label>
                  <div className="relative">
                    <input id="password" type={showPassword ? "text" : "password"} value={password}
                           onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
                           autoComplete="new-password" className={`${field} pr-12`} required />
                    <button type="button" onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-secondary">
                      {showPassword ? <EyeOff className="size-5 text-muted-foreground" /> : <Eye className="size-5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="confirm" className="mb-2 block text-sm font-medium text-foreground">Confirm password</label>
                  <input id="confirm" type={showPassword ? "text" : "password"} value={confirm}
                         onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password"
                         autoComplete="new-password" className={field} required />
                </div>

                <button type="submit" disabled={busy}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-navy disabled:opacity-60">
                  {busy ? "Creating your account…" : "Create account"} <ArrowRight className="size-4" />
                </button>
              </form>

              <p className="mt-6 text-xs leading-6 text-muted-foreground">
                Accounts are for family custodians and the people they invite. Creating one doesn&apos;t open a vault —
                a custodian adds you to theirs, or you commission a new vault once you&apos;re in.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
