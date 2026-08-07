# Hook Iteration From a Proven Reference

Inventing a hook from a blank page is a guess. Extracting the formula from a hook that's *already proven* — already run, already stopped scrolls, already sold — and generating variations locked to that formula is not a guess; you're testing execution of a known-working structure, not the structure itself. This is a different move from `01_hooks_and_headlines.md` and `10_lead_archetypes.md`, which cover which levers and shapes exist. This file covers how to iterate once you have a real winner to start from, not a blank page.

## Extracting the formula

A proven hook is built from two layers — separate them before touching either:

- **What's fixed (the formula)**: the lead type (`10_lead_archetypes.md`), which lever it pulls (`01_hooks_and_headlines.md`), and its rhythm/length. This is what made it work and must survive every variation.
- **What's a slot (the specifics)**: the exact pain point, number, timeframe, or mechanism named. This is what gets reworded per variation, sourced fresh from the current product/audience inputs — never copied verbatim from a competitor's or a past winner's actual claim.

## Worked example

Reference hook (Problem-Solution lead, self-interest lever): *"You know how you can never fall asleep at night?"*

Variations that preserve the formula while changing the specifics:
- Swap the mechanism: *"There's a reason you can't sleep, and it has nothing to do with your mattress."*
- Swap to a proof-number variant of the same lead: *"38,000 people fixed their sleep with this — here's how."*
- Swap to first-person Reluctant Hero framing (`20_attractive_character.md`) of the same problem-solution shape: *"I changed one thing before bed. Now I'm asleep in 5 minutes."*
- Swap the urgency framing (`03_psychological_triggers.md`) while keeping the lead type: *"Your sleep problems get worse the longer you wait."*

Each variation is a distinct test of the same proven shape — not five restatements of one idea, and not five unrelated shots in the dark.

## Practical rule for this engine

When swipe examples are present in the prompt (`swipeFileService.formatSwipeExamplesForPrompt`), treat their hooks as formulas to iterate on, not just inspiration to skim: identify the lead type and lever each one uses, then generate this call's variations by locking to those formulas and resourcing the specifics from the current brand/product/audience inputs. This produces higher hit-rate variations than free-form ideation because the structure is already de-risked — only the execution is being tested.
