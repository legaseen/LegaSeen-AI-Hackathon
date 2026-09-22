/**
 * The shape of a guided life-story session.
 *
 * Drawn from how oral historians actually run these: open with a slate and a
 * welcome (Library of Congress Veterans History Project), start with
 * childhood because it is safe ground (Southern Oral History Program), follow
 * a chapter spine with a few key scenes — a high point, a low point, a turning
 * point (McAdams, The Life Story Interview) — and close on what they want the
 * family to keep, never on the hardest thing (StoryCorps).
 *
 * `prompts` are examples for the model, not a script. It asks from what was
 * actually said; these show the register and the ground each part covers.
 */
export type Phase = {
  id: string;
  title: string;
  goal: string;
  prompts: string[];
  /** Questions before we move on. A part can be skipped or cut short. */
  turns: number;
};

export const PHASES: Phase[] = [
  {
    id: "welcome", title: "Getting settled", turns: 2,
    goal: "Slate the recording and settle in. Their full name, where and when they were born; who they picture watching this one day.",
    prompts: [
      "To begin, could you tell me your full name, and where and when you were born?",
      "Who do you picture watching this one day?",
    ],
  },
  {
    id: "origins", title: "Where you came from", turns: 4,
    goal: "The family they were born into: parents and grandparents, where the family came from and what they did, the house and street of earliest memory.",
    prompts: [
      "What do you know about where your parents' families came from?",
      "What was your mother like — what do you see when you picture her?",
      "What did your father do, and what did his days look like?",
      "Describe the house you first remember living in.",
    ],
  },
  {
    id: "childhood", title: "Growing up", turns: 4,
    goal: "Daily life as a child: school, friends, games, chores, food, holidays. One vivid happy memory and, if they offer it, one hard one.",
    prompts: [
      "What was school like for you?",
      "What did you do for fun — what did a Saturday look like?",
      "What did the house smell like at dinner time?",
      "What is your happiest memory from those years?",
    ],
  },
  {
    id: "youth", title: "Becoming yourself", turns: 4,
    goal: "Leaving school, the first job, first love, leaving home. The music and the world of that time, and what they dreamed of.",
    prompts: [
      "What was your very first job, and what did you buy with the first pay?",
      "Do you remember the first time you fell in love?",
      "What did you want to be when you were seventeen?",
      "What was happening in the world then, and how did it reach you?",
    ],
  },
  {
    id: "work", title: "Work and purpose", turns: 3,
    goal: "The main work of their life: how they came to it, what they were good at, a day they are proud of, what it cost them.",
    prompts: [
      "How did you come to do the work you did?",
      "What were you good at that other people didn't notice?",
      "Tell me about a day at work you will never forget.",
    ],
  },
  {
    id: "love", title: "Love and family", turns: 4,
    goal: "Partners: how they met, the wedding or the deciding moment. Children: the day they arrived, what kind of parent they tried to be, home life.",
    prompts: [
      "How did you meet your partner?",
      "Tell me about your wedding day — or the day you decided.",
      "What do you remember of the day your first child was born?",
      "What kind of parent did you try to be?",
    ],
  },
  {
    id: "history", title: "The world around you", turns: 3,
    goal: "The big events they lived through — war, migration, hard times, great change — as they experienced them personally, not as history.",
    prompts: [
      "Where were you when the biggest event of your era happened?",
      "What was the hardest time for the country, as you lived it?",
      "What has changed most in the world since you were young?",
    ],
  },
  {
    id: "turning", title: "Turning points", turns: 4,
    goal: "Key scenes: a high point, a low point, a moment when everything changed. How they got through the hardest thing, and who helped.",
    prompts: [
      "What is a moment you would call the high point of your life?",
      "What was the hardest thing you have been through, and how did you get through it?",
      "Was there a moment when your life changed direction?",
      "Who helped you when you needed it most?",
    ],
  },
  {
    id: "reflection", title: "Looking back", turns: 3,
    goal: "What they believe, what they are proudest of, what they would do again, what they learned that they wish they had known sooner.",
    prompts: [
      "What are you proudest of?",
      "What do you know now that you wish you had known at twenty?",
      "What has mattered most, in the end?",
    ],
  },
  {
    id: "closing", title: "A message for the family", turns: 2,
    goal: "Speak directly to the people who will watch this. Anything not yet said that they want kept. Then thank them and close warmly.",
    prompts: [
      "If your grandchildren watch this in fifty years, what do you want to say to them?",
      "Is there anything we haven't talked about that you would like to keep here?",
    ],
  },
];

export const TOTAL_TURNS = PHASES.reduce((n, p) => n + p.turns, 0);

/** Spoken once, before the first question. Personalised, never generated. */
export function introFor(subject: string): string {
  return `Hello ${subject}, it's lovely to meet you. I'm going to sit with you today and help you tell your story, for your family. ` +
    `There are no right or wrong answers. Take all the time you need, and if there's anything you'd rather not talk about, just say so and we'll move on. ` +
    `We'll start with where you came from, and make our way through your life. Whenever you're ready, we'll begin.`;
}

/** Spoken after the last answer. */
export function farewellFor(subject: string): string {
  return `Thank you, ${subject}. That was a wonderful thing to give them. We'll stop the recording there.`;
}

/**
 * Which part we are in, given the questions asked so far and any parts the
 * person chose to skip. Returns PHASES.length when the session is complete.
 */
export function currentPhaseIndex(asked: { phase: string }[], skipped: string[]): number {
  for (let i = 0; i < PHASES.length; i++) {
    const p = PHASES[i]!;
    if (skipped.includes(p.id)) continue;
    const n = asked.filter((t) => t.phase === p.id).length;
    if (n < p.turns) return i;
  }
  return PHASES.length;
}
