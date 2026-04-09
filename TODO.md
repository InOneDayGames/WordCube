# TODO

## Next
- Delay the game-over overlay so the final cube state remains visible before the end screen appears.
- Allow tapping an already selected face to rewind the path to that point.
- Improve or finish gameplay affordances around legal words and minimum length.
- Add a tutorial or clearer help text.
- Accessibility pass: contrast, focus states, reduced motion, readable status messaging.
- Performance pass for mobile GPUs and lower-end devices.
- Add onboarding-safe loading and error states.

## Backlog
- Embed a web font for cube-face letters if we want total cross-device consistency.
- Add juice to gameplay, like blocks flying off, while keeping the overall feel Wordle-like.
- Add more juice to the game-over screen.
- Add sound/haptics settings, especially for mobile.
- Add a settings area for motion, sound, sensitivity, and maybe left-handed play.
- Add a proper results/share screen for score, longest word, and daily challenge outcome.
- Add a persistent seed/shareable game ID so the same puzzle can be replayed and debugged across devices.
- Set up a daily challenge system.
- Embed a 9-letter word in every cube.
- Add analytics-friendly instrumentation or local debug counters for failed taps, invalid selections, and session outcomes.
- Add basic automated test coverage for cube rules and word validation flow.

## Done
- Fix mobile usability: drag, aspect ratio, and layout.
- Improve selection responsiveness so input feels snappier.
- Fix the laggy submit button feel.
- Improve the look of the blocks and remove visible gaps between them.
- Redesign the overall presentation so it feels like a serious Wordle-style competitor.
- Improve the presentation of Found Words.
- Replace UI system font stacks with a deliberate web font.
- Get layout working on tablet form.
- Improve word-preview affordances, including the 4+ letters empty state and valid-word highlighting.
- Set up GitHub Pages hosting.
