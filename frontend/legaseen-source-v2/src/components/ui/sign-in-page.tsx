import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { useAuthProviders } from "@/lib/auth";

type Notice = { tone: "error" | "ok"; text: string } | null;
type Busy = null | "password" | "google" | "github" | "reset";

/**
 * Split sign-in page: full-bleed portrait on the left, form on the right.
 * Every control talks to Supabase Auth; nothing here is decorative except
 * "remember me" (sessions already persist) and the invitation note.
 */
export function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const providers = useAuthProviders();
  const origin = typeof window !== "undefined" ? window.location.origin : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password"); setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(null);
    if (error) setNotice({ tone: "error", text: error.message });
  }

  async function withProvider(provider: "google" | "github") {
    const label = provider === "google" ? "Google" : "GitHub";
    if (providers && !providers[provider]) {
      return setNotice({ tone: "error", text: `${label} sign-in isn't switched on for this archive yet. Use your email and password, or ask the archive team to enable it.` });
    }
    setBusy(provider); setNotice(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: origin ? { redirectTo: origin } : {} });
    if (error) { setBusy(null); setNotice({ tone: "error", text: error.message }); }
  }

  async function forgotPassword() {
    if (!email.trim()) return setNotice({ tone: "error", text: "Enter your email address first, then choose Forgot password." });
    setBusy("reset"); setNotice(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), origin ? { redirectTo: origin } : {});
    setBusy(null);
    setNotice(error ? { tone: "error", text: error.message }
                    : { tone: "ok", text: `Password reset instructions have been sent to ${email.trim()}.` });
  }

  const field =
    "w-full rounded-xl border border-input bg-background px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-gold";

  return (
    <div className="flex min-h-screen w-full bg-gradient-to-br from-navy via-primary to-navy">
      {/* Left panel — portrait */}
      <div className="relative hidden flex-1 overflow-hidden lg:block">
        <img src="/login-portrait.jpg" alt="An elder recounting a story in her study"
             className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/85 via-navy/10 to-navy/20" />
        <img src="/legaseen-logo.png" alt="LegaSeen" width={1200} height={300} className="absolute left-8 top-8 h-11 w-auto drop-shadow" />
        <div className="absolute inset-x-8 bottom-10 text-ivory">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-gold">Restored 35mm oral history</p>
          <p className="mt-3 max-w-md font-display text-2xl italic leading-snug">&ldquo;The voice keeps what the picture alone cannot tell.&rdquo;</p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 items-center justify-center bg-card">
        <div className="w-full max-w-md p-8">
          <img src="/legaseen-logo.png" alt="LegaSeen" width={1200} height={300} className="mb-8 h-10 w-auto lg:hidden" />
          <div className="mb-8">
            <h1 className="mb-2 font-display text-3xl font-bold text-navy">Welcome Back</h1>
            <p className="text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link to="/signup" className="font-medium text-primary hover:text-gold-strong">Create one</Link>
            </p>
          </div>

          {notice && (
            <p role="status" className={`mb-6 rounded-xl border px-4 py-3 text-sm ${notice.tone === "error"
              ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-gold bg-secondary text-navy"}`}>
              {notice.text}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground">Email Address</label>
              <input id="email" type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)}
                     placeholder="Email Address" autoComplete="email" className={field} required />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-foreground">Password</label>
              <div className="relative">
                <input id="password" type={showPassword ? "text" : "password"} name="password" value={password}
                       onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password"
                       className={`${field} pr-12`} required />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-secondary">
                  {showPassword ? <EyeOff className="size-5 text-muted-foreground" /> : <Eye className="size-5 text-muted-foreground" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2 text-sm text-muted-foreground">
                <input type="checkbox" name="rememberMe" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                       className="size-4 rounded border-input accent-primary" />
                <span>Remember me</span>
              </label>
              <button type="button" onClick={forgotPassword} disabled={busy !== null}
                      className="text-sm font-medium text-primary hover:text-gold-strong disabled:opacity-50">
                Forgot password?
              </button>
            </div>

            <button type="submit" disabled={busy !== null}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-navy disabled:opacity-60">
              {busy === "password" ? "Signing in…" : "Sign In"} <ArrowRight className="size-4" />
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-sm"><span className="bg-card px-2 text-muted-foreground">or</span></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button type="button" onClick={() => withProvider("google")} disabled={busy !== null}
                      title={providers && !providers["google"] ? "Not switched on for this archive yet" : undefined}
                      className={`flex items-center justify-center rounded-xl border border-border px-4 py-3 hover:bg-secondary disabled:opacity-60 ${providers && !providers["google"] ? "opacity-55" : ""}`}>
                <svg className="mr-2 size-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span className="text-sm font-medium text-foreground">{busy === "google" ? "Redirecting…" : "Continue with Google"}</span>
              </button>
              <button type="button" onClick={() => withProvider("github")} disabled={busy !== null}
                      title={providers && !providers["github"] ? "Not switched on for this archive yet" : undefined}
                      className={`flex items-center justify-center rounded-xl border border-border px-4 py-3 hover:bg-secondary disabled:opacity-60 ${providers && !providers["github"] ? "opacity-55" : ""}`}>
                <svg className="mr-2 size-5" fill="#24292f" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <span className="text-sm font-medium text-foreground">{busy === "github" ? "Redirecting…" : "Continue with GitHub"}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
