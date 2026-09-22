import { Home, Video as VideoIcon, Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Vault } from "@/lib/supabase";
import type { RecordMode } from "@/components/record-story";

/** Where concierge and Zoom requests go. Replace with the real address. */
export const ARCHIVE_TEAM_EMAIL = "archive@legaseen.com";

export function requestLink(tier: string, vault: Vault, custodian: string) {
  const subject = `${tier} request — ${vault.subject_name} (${vault.name})`;
  const body = [
    `Tier: ${tier}`, `Elder: ${vault.subject_name}`, `Archive: ${vault.name}`, `Vault id: ${vault.id}`,
    `Custodian: ${custodian}`, "", "Preferred dates / location / anything we should know:", "",
  ].join("\n");
  return `mailto:${ARCHIVE_TEAM_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** The three ways a vault gets its recordings. Shown after a vault is created, and on any vault without one. */
export function TierCards({ vault, custodian, onRecord }: { vault: Vault; custodian: string; onRecord: (mode: RecordMode) => void }) {
  const tiers = [
    {
      key: "concierge", label: "Premium · Concierge", icon: Home,
      title: "We come to them",
      blurb: `Our crew sets up a film studio in ${vault.subject_name}'s living room and interviews them on camera for one to two hours.`,
      points: ["Professionally filmed and lit", "Family photos and home videos woven in", "A finished documentary film, plus the full transcript, delivered into this vault"],
      action: <Button asChild className="bg-gold text-navy hover:bg-gold-strong"><a href={requestLink("Premium concierge visit", vault, custodian)}>Request a home visit</a></Button>,
    },
    {
      key: "zoom", label: "Mid-range · Online", icon: VideoIcon,
      title: "We interview them over Zoom",
      blurb: "The same guided interview, recorded over a video call with one of our interviewers, then edited and delivered here.",
      points: ["No travel, any location", "Guided by an interviewer", "Edited film and transcript delivered into this vault"],
      action: <Button asChild variant="outline"><a href={requestLink("Zoom interview session", vault, custodian)}>Book a Zoom session</a></Button>,
    },
    {
      key: "self", label: "Self-serve", icon: Mic,
      title: "Record it yourselves",
      blurb: `${vault.subject_name} speaks to the camera whenever they like — on a phone or laptop — and the story goes straight into this vault.`,
      points: ["Record right here, or upload a video you already have", "Stored privately in the vault", "Indexed into chapters and a transcript by the archive"],
      action: (
        <div className="flex gap-2">
          <Button onClick={() => onRecord("record")} className="bg-gold text-navy hover:bg-gold-strong">Record now</Button>
          <Button onClick={() => onRecord("upload")} variant="outline">Upload a video</Button>
        </div>
      ),
    },
  ] as const;

  return (
    <section className="mt-9">
      <p className="eyebrow">Add the first recording</p>
      <h2 className="mt-2 font-display text-3xl font-bold text-navy">How will {vault.subject_name}&apos;s stories be recorded?</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Every path ends the same way: a recording in this vault, indexed into chapters with a synchronized transcript.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {tiers.map((t) => (
          <article key={t.key} className="flex flex-col border border-border bg-card p-6 shadow-paper">
            <span className="grid size-11 place-items-center rounded-lg bg-secondary text-primary"><t.icon className="size-5" /></span>
            <p className="eyebrow mt-5">{t.label}</p>
            <h3 className="mt-2 font-display text-xl font-bold text-navy">{t.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.blurb}</p>
            <ul className="mt-4 space-y-1.5 text-sm text-foreground">
              {t.points.map((pt) => <li key={pt} className="flex gap-2"><span className="text-gold-strong">✦</span><span>{pt}</span></li>)}
            </ul>
            <div className="mt-auto pt-6">{t.action}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
