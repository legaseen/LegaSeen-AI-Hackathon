# Evaluation report

Run 2026-09-21T23:53+00:00 · `python evals/run.py --live`

| Suite | Result | Checks | Metrics | Time |
|---|---|---|---|---|
| crisis_regex | ✅ pass | 1/1 | cases 41 | 0s |
| guard | ✅ pass | 1/1 | cases 15 | 0s |
| segments | ✅ pass | 13/13 | chapters 8, coverage 96% | 0s |
| crisis_llm | ✅ pass | 1/1 | cases 10 | 10s |
| search | ✅ pass | 17/17 | relevance 12/12, crisis blocked 3/3, off-topic refused 2/2 | 19s |
| interview | ✅ pass | 91/91 | questions 16, guard retries 3, guard fallbacks 0, judge builds_on 3.5/5, judge concrete 4.0/5, judge warm 4.3/5 | 45s |

## interview — transcript

```
  welcome    A: I'm Ria Wright, born in Newcastle, New South Wal -> Q: When you picture someone in your family watching this recording, who comes to mind first?
  origins    A: Oh, love, I see little Margaret there first, my  -> Q: Let's talk about the family you were born into and your first memories of home. What can you tell me about your parents—what kinds of people were they when you were little?
  origins    A: Oh, mum was small and quick, always singing as s -> Q: What do you remember about that two-room house—were there any special things on the walls or shelves?
  origins    A: Oh, love, it was simple as could be. Just plain  -> Q: What sort of street was it with the Hardings next door—were there many children playing outside?
  origins    A: Oh, it was always lively, love. Kids all about,  -> Q: What do you remember most about your neighbours, the Hardings—who in their family stands out in your memory?
  childhood  A: Oh, the Hardings were good folks, shared that pu -> Q: Let's talk about your school days now. What was your school like, Ria—can you remember what it looked or smelled like when you first walked in?
  childhood  A: Oh, love, the school was a simple place, nothing -> Q: What did you usually have for lunch at school in those days?
  childhood  A: Lunch was simple, love. Mostly bread and a bit o -> Q: You mentioned playing cricket in the creek bed—what was the creek like, and who were your usual mates out there?
  childhood  A: Mutton.                                          -> Q: You said 'Mutton'—was that someone’s nickname, or does it have a story behind it?
  youth      A: Oh, love, no nickname there. Mutton was just the -> Q: Let's talk about your school days coming to an end, and the world opening up after that. When you left school, what was the first job you found, and how did it feel to start working?
  work       A: I'd rather not talk about that time, love.       -> Q: Let’s talk about the work you did through your life, Ria. What was the main kind of work you ended up doing—what was your day-to-day like there?
  work       A: I was a primary school teacher for nigh on forty -> Q: That flood in ’55 sounds rough. What do you remember most about carrying those little ones to safety?
  work       A: Ah love, it was a proper mess, water everywhere  -> Q: You said you tried to make the scared little ones feel safe—how did you spot which children needed extra care?
  love       A: Ah love, you could just see it in their eyes, th -> Q: Let's talk about your love and family now. How did you first meet your partner, Ria?
  love       A: Oh, I met Frank at a dance at the Palais back in -> Q: What was the Palais like on the night you met Frank—do you remember what music was playing?
  love       A: Oh, the Palais was full of laughter and chatter, -> Q: What did Frank look like that night at the Palais, when you first saw him across the room?
```
