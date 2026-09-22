import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Camera, Check, Images, Lock, Mic, Plus, Search, ShieldCheck } from "lucide-react";

import { ArchiveShell, LoadingBlock, Still, metadata } from "@/components/archive-shell";
import { LoginPage } from "@/components/ui/sign-in-page";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { supabase, type MediaAsset, type Vault } from "@/lib/supabase";
import { signedUrls } from "@/lib/transcript";
import { displayName, useSession } from "@/lib/auth";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => metadata("Welcome to Your Family Archive — LegaSeen", "Choose a family vault and enter a private collection of preserved memories."),
  component: IndexPage,
});

function IndexPage() {
  const { session, ready } = useSession();
  if (!ready) return <ArchiveShell><LoadingBlock label="Opening the archive…" /></ArchiveShell>;
  if (!session) return <LoginPage />;
  return <WelcomePage name={displayName(session)} />;
}

/* ---------------------------------------------------------------- archive */

type VaultCard = Vault & {
  interviews: number; stories: number; photos: number; seconds: number;
  poster: string | null; sessionTitle: string | null; latest: string;
};
type Lineage = "all" | "maternal" | "paternal";
type Sort = "recent" | "az";

async function loadVaults(): Promise<VaultCard[]> {
  const { data: vaults } = await supabase.from("vaults").select("id,name,subject_name,description").order("created_at");
  const { data: media } = await supabase.from("media_assets").select("id,vault_id,media_type,title,duration_seconds,created_at").order("created_at");
  const { data: segs } = await supabase.from("story_segments").select("vault_id");
  const list = (vaults ?? []) as Vault[];
  type M = Pick<MediaAsset, "id" | "vault_id" | "media_type" | "title" | "duration_seconds" | "created_at">;
  const all = (media ?? []) as M[];
  const interviews = all.filter((m) => m.media_type !== "photo");
  const firstByVault = new Map<string, M>();
  for (const m of interviews) if (!firstByVault.has(m.vault_id)) firstByVault.set(m.vault_id, m);
  const posters = await signedUrls("interview-videos",
    [...firstByVault].map(([vaultId, m]) => `${vaultId}/${m.id}-poster.jpg`));
  return list.map((v) => {
    const mine = interviews.filter((m) => m.vault_id === v.id);
    const first = firstByVault.get(v.id);
    return {
      ...v,
      interviews: mine.length,
      stories: (segs ?? []).filter((s) => s.vault_id === v.id).length,
      photos: all.filter((m) => m.vault_id === v.id && m.media_type === "photo").length,
      seconds: mine.reduce((n, m) => n + (m.duration_seconds ?? 0), 0),
      poster: first ? posters[`${v.id}/${first.id}-poster.jpg`] ?? null : null,
      sessionTitle: first?.title ?? null,
      latest: mine.at(-1)?.created_at ?? "",
    };
  });
}

/** Lineage isn't a column; it's read from the vault description when the family wrote it there. */
function lineageOf(v: Vault): Exclude<Lineage, "all"> | null {
  const d = (v.description ?? "").toLowerCase();
  if (/\bmaternal\b|\bmother'?s side\b/.test(d)) return "maternal";
  if (/\bpaternal\b|\bfather'?s side\b/.test(d)) return "paternal";
  return null;
}

function WelcomePage({ name }: { name: string }) {
  const [filter, setFilter] = useState("");
  const [lineage, setLineage] = useState<Lineage>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const { data: vaults, isLoading } = useQuery({ queryKey: ["vaults"], queryFn: loadVaults, staleTime: 30 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const all = vaults ?? [];
  const count = (l: Exclude<Lineage, "all">) => all.filter((v) => lineageOf(v) === l).length;
  const shown = all
    .filter((v) => (!filter.trim() || `${v.subject_name} ${v.name} ${v.description ?? ""}`.toLowerCase().includes(filter.toLowerCase()))
                && (lineage === "all" || lineageOf(v) === lineage))
    .sort((a, b) => sort === "az" ? a.subject_name.localeCompare(b.subject_name) : b.latest.localeCompare(a.latest));

  return (
    <ArchiveShell>
      <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="max-w-3xl">
          <p className="eyebrow flex items-center gap-2"><Lock className="size-3.5" /> Private family custody</p>
          <h1 className="mt-2 font-display text-4xl font-bold text-navy sm:text-5xl">Welcome, {name}</h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">You hold custody over your family archives. Select an elder&apos;s vault to enter their recordings, chapters and photographs.</p>
        </div>


        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-2.5 shadow-paper lg:flex-row lg:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-input bg-background px-5 focus-within:border-gold">
            <Search className="size-4 text-muted-foreground" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)}
                   className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                   placeholder="Search vaults by ancestor name, branch, or archive title…" />
          </label>
          <div className="flex gap-1 rounded-full border border-border bg-background p-1">
            {([["all", "All Lineages"], ["maternal", `Maternal (${count("maternal")})`], ["paternal", `Paternal (${count("paternal")})`]] as const).map(([key, label]) => (
              <Button key={key} size="sm" variant={lineage === key ? "default" : "ghost"} onClick={() => setLineage(key)}>{label}</Button>
            ))}
          </div>
          <label className="flex h-10 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm">
            <span className="text-muted-foreground">Sort:</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="bg-transparent font-medium text-navy outline-none">
              <option value="recent">Most recent memories</option>
              <option value="az">Ancestor A–Z</option>
            </select>
          </label>
        </div>

        {isLoading && <LoadingBlock label="Unlocking vaults…" />}
        {!isLoading && shown.length === 0 && all.length > 0 && (
          <p className="mt-8 text-sm text-muted-foreground">No vaults match that search{lineage !== "all" ? " in this lineage" : ""}.</p>
        )}

        <div className="mt-5 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((v, i) => {
            const branch = lineageOf(v);
            return (
              <article key={v.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-paper">
                <div className="relative aspect-video bg-navy">
                  {v.poster
                    ? <img src={v.poster} alt={`${v.subject_name} portrait`} className="size-full object-cover" loading="lazy" />
                    : <div className="grid size-full place-items-center">
                        <span className="grid size-24 place-items-center rounded-full border-2 border-gold/60 font-display text-3xl italic text-gold">
                          {v.subject_name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                      </div>}
                  {v.sessionTitle && (
                    <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-navy/85 px-3 py-1 text-[0.65rem] font-semibold text-ivory backdrop-blur">
                      <Camera className="size-3 text-gold" /> {v.sessionTitle}
                    </span>
                  )}
                  {branch && (
                    <span className="absolute bottom-3 left-3 rounded-md bg-ivory/90 px-2.5 py-1 text-[0.65rem] font-semibold capitalize text-navy">{branch} branch</span>
                  )}
                  {v.seconds > 0 && (
                    <span className="absolute bottom-3 right-3 rounded-md bg-black/70 px-2.5 py-1 font-mono text-[0.65rem] text-ivory">{Math.round(v.seconds / 60)} min recording</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="font-display text-2xl font-bold text-navy">{v.subject_name}</h2>
                    <span className="shrink-0 font-display text-sm italic text-muted-foreground">{v.name}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{v.description ?? "A private collection of recorded testimony."}</p>
                  <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    <li className="flex items-center gap-1.5"><Mic className="size-3.5 text-gold-strong" />{v.stories} Stories</li>
                    <li aria-hidden>·</li>
                    <li className="flex items-center gap-1.5"><Images className="size-3.5 text-gold-strong" />{v.photos} Photos</li>
                    <li aria-hidden>·</li>
                    <li className={v.stories > 0 ? "font-semibold text-green-700" : "font-semibold text-gold-strong"}>
                      {v.stories > 0 ? "Transcript synced" : v.interviews > 0 ? "Awaiting processing" : "No recordings yet"}
                    </li>
                  </ul>
                  <Button asChild variant="outline" className="mt-4 w-full border-gold/60 text-navy hover:bg-secondary">
                    <Link to="/vault/$vaultId" params={{ vaultId: v.id }}>Enter Vault <ArrowRight /></Link>
                  </Button>
                </div>
              </article>
            );
          })}

          <CommissionCard />
        </div>

        <CustodyBanner />
      </section>
    </ArchiveShell>
  );
}

function CustodyBanner() {
  return (
    <section className="mt-8 flex flex-col gap-5 rounded-xl border border-border bg-secondary/60 p-5 sm:flex-row sm:items-center">
      <span className="grid size-14 shrink-0 place-items-center rounded-lg border border-gold/40 bg-card text-gold-strong"><ShieldCheck className="size-6" /></span>
      <div className="flex-1">
        <h2 className="font-display text-xl font-bold text-navy">Hereditary Vault Security &amp; Custody</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          You are the custodian of the vaults you create. Each vault&apos;s owner can name family members as editors, who may add recordings and photographs, or viewers, who may only watch and search.
        </p>
      </div>
      <Dialog>
        <DialogTrigger asChild><Button variant="outline" className="shrink-0">How custody works <ArrowRight /></Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-navy">Custody roles</DialogTitle>
            <DialogDescription>Access is enforced by the archive database itself, per vault.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-3 text-sm leading-6">
            <li><b className="text-navy">Owner</b> — created the vault. Can add recordings and photographs, name editors and viewers, and delete the vault.</li>
            <li><b className="text-navy">Editor</b> — a family member the owner names. Can add recordings and photographs and run the archive on them.</li>
            <li><b className="text-navy">Viewer</b> — can watch, read the transcript and search, but change nothing.</li>
          </ul>
          <p className="text-xs text-muted-foreground">Naming editors and viewers from inside the app is coming; for now the archive team sets them up on request.</p>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Same footprint as a vault card. Opens the commissioning form; the tier choice is the next step. */
function CommissionCard() {
  const [open, setOpen] = useState(false);
  return (
    <article className="relative flex flex-col overflow-hidden rounded-xl border border-gold/30 bg-gradient-to-b from-navy to-[oklch(0.16_0.05_262)] p-6 text-ivory shadow-paper">
      <span aria-hidden className="absolute -right-20 -top-24 size-64 rounded-full bg-gold/5" />
      <span className="relative grid size-14 place-items-center rounded-lg border border-gold/60 bg-gold/10 text-gold"><Plus className="size-6" /></span>
      <p className="relative mt-6 text-[0.62rem] font-bold uppercase tracking-[0.18em] text-gold">Next generation custody</p>
      <h2 className="relative mt-2 font-display text-2xl font-bold">Commission New Vault</h2>
      <p className="relative mt-3 text-sm leading-6 text-ivory/75">Record and preserve the stories, voice recordings, and living memories of another elder in the family before they are lost to time.</p>
      <ul className="relative mt-5 space-y-2 text-sm text-ivory/90">
        {["Concierge filming at home, or an interview over Zoom", "Self-serve recording from any phone or laptop", "Chapters and a synchronized transcript by the archive"].map((t) => (
          <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-gold" /><span>{t}</span></li>
        ))}
      </ul>
      <div className="relative mt-auto border-t border-ivory/10 pt-6">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="lg" className="w-full bg-gold text-navy hover:bg-gold-strong">Begin Archiving <ArrowRight /></Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <CommissionForm onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
        <p className="mt-3 text-center text-[0.68rem] text-ivory/50">You choose how the stories are recorded on the next step</p>
      </div>
    </article>
  );
}

type LineageChoice = "" | "Maternal" | "Paternal";

/**
 * Creates the vault as the signed-in user, who becomes its owner (and so an
 * editor for the pipeline). Goes through RLS: needs the vaults_insert_owner
 * policy, which is currently missing on the live database.
 */
function CommissionForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [lineage, setLineage] = useState<LineageChoice>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const suggestedTitle = subject.trim() ? `${subject.trim().split(" ")[0]}'s Archive` : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const subjectName = subject.trim();
    const name = (title.trim() || suggestedTitle).trim();
    if (subjectName.length < 2) return setErr("Tell us the elder's name.");
    if (!name) return setErr("Give the archive a title.");

    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setBusy(false); return setErr("You're not signed in."); }

    // Lineage has no column; it's kept in the description where the archive
    // page's Maternal/Paternal filter reads it.
    const description = [lineage ? `${lineage} lineage.` : "", notes.trim()].filter(Boolean).join(" ") || null;

    // The id is generated here rather than read back, because asking for the
    // new row in the same statement fails: the vaults SELECT policy calls
    // is_vault_member(), a STABLE SECURITY DEFINER function that queries
    // vaults itself and so cannot see a row still being inserted. The insert
    // is allowed; only the RETURNING clause was being refused. Knowing the id
    // up front means we never need it back.
    const id = crypto.randomUUID();
    const { error } = await supabase.from("vaults")
      .insert({ id, owner_id: uid, name, subject_name: subjectName, description });
    setBusy(false);

    if (error) return setErr(error.message);

    await queryClient.invalidateQueries({ queryKey: ["vaults"] });
    onDone();
    navigate({ to: "/vault/$vaultId", params: { vaultId: id } });
  }

  const field = "mt-1.5 h-11 w-full border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-gold";
  const label = "block text-[0.62rem] font-bold uppercase tracking-[0.14em] text-muted-foreground";

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl text-navy">Commission a new vault</DialogTitle>
        <DialogDescription className="leading-6">
          A vault holds one elder&apos;s recordings, chapters and photographs. You&apos;ll be its custodian. Next you choose how the stories get recorded: our crew at their home, over Zoom, or by yourselves.
        </DialogDescription>
      </DialogHeader>

      {err && <p role="alert" className="mt-4 border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}

      <div className="mt-5 space-y-4">
        <label className={label}>Elder&apos;s name
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Ria Weissman" required autoFocus className={field} />
        </label>
        <label className={label}>Archive title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={suggestedTitle || "e.g. One Hundred Years"} className={field} />
        </label>
        <div>
          <span className={label}>Lineage</span>
          <div className="mt-1.5 flex gap-2">
            {(["", "Maternal", "Paternal"] as const).map((v) => (
              <Button key={v || "none"} type="button" size="sm" variant={lineage === v ? "default" : "outline"} onClick={() => setLineage(v)}>
                {v || "Not stated"}
              </Button>
            ))}
          </div>
        </div>
        <label className={label}>About this vault <span className="font-normal normal-case tracking-normal">(optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                    placeholder="Where she grew up, who she is to the family, what the recordings cover…"
                    className="mt-1.5 w-full border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold" />
        </label>
      </div>

      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onDone} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy} className="bg-gold text-navy hover:bg-gold-strong">
          {busy ? "Opening the vault…" : "Create vault"} <ArrowRight />
        </Button>
      </DialogFooter>
    </form>
  );
}
