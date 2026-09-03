---
name: design-check
description: Audit a UI component or page against the project's visual spec. Use after building or changing any interface code, or when asked to review a view's design.
---

Read @docs/design.md, then audit the file(s) I name against it.

Check specifically:

1. Are there rounded cards where a table belongs?
2. How many primary/verdigris actions are in this view? More than one is a bug.
3. Any shadow on something that doesn't float?
4. Any raw hex or Tailwind color class instead of a token?
5. More than two border-radius values?
6. Font weights other than 400 and 600?
7. Tabular numerals on every time, date, and count?
8. Any item from the banned list in docs/design.md section 2?
9. Title Case or ALL CAPS anywhere?
10. Empty and error states — do they instruct, or do they apologize?

Report violations with file and line. Don't fix anything until I say so.

Say "clean" only if all ten pass. Do not soften the report to be agreeable.
