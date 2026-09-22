import { createFileRoute } from "@tanstack/react-router";

import { metadata } from "@/components/archive-shell";
import { SignUpPage } from "@/components/ui/sign-up-page";

export const Route = createFileRoute("/signup")({
  ssr: false,
  head: () => metadata("Create an account — LegaSeen", "Start a private family archive and preserve an elder's stories."),
  component: SignUpPage,
});
