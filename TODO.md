# TODO

## Next
- Prune and improve dictionaries, possibly ranked by word popularity.
- Add more juice to the game-over screen.
- Add sound/haptics settings, especially for mobile.
- Embed a 9-letter word in every cube.

## Backlog
- Before public launch, decide whether to keep the tester two-hour cube refresh cadence or switch back to one cube per day.
- Accessibility pass: contrast, focus states, reduced motion, readable status messaging.

- Add onboarding-safe loading and error states.
- Finish the game-over screen polish: tighten the typography and fix portrait-tablet sizing/positioning.
- Add a settings area for motion, sound, sensitivity, and maybe left-handed play.
- Add analytics-friendly instrumentation or local debug counters for failed taps, invalid selections, and session outcomes.
- Add basic automated test coverage for cube rules and word validation flow.
- Performance pass for mobile GPUs and lower-end devices.
- Ensure hints only suggest words that are also present in the legal dictionary.

## Feedback from users
- Zoe found it too difficult at the start.
- Jake was finding obscure words by selecting letters and looking for red highlighting.
- Emma wanted longer words because they would feel more satisfying.
- Emma misunderstood the goal and thought it was to clear the board as quickly as possible.

## Done
- Add a results/share screen for score, masked longest word, outcome, and next-cube countdown.
- Set up a daily challenge system.
- Store daily puzzle progress locally so refreshes resume the same day’s game.
- Add an optional daily puzzle manifest override for future curation.
- Add a persistent seed/shareable game ID so the same puzzle can be replayed and debugged across devices.
- Test adding a fade as blocks shrink during the submit removal animation, and keep the cleaner whole-block shrink without fade.
- Add restrained gameplay juice for submitted blocks.
- Add a tutorial or clearer help text.
- Allow tapping an already selected face to rewind the path to that point.
- Improve or finish gameplay affordances around legal words and minimum length.
- Fix mobile usability: drag, aspect ratio, and layout.
- Improve selection responsiveness so input feels snappier.
- Fix the laggy submit button feel.
- Add a web font for cube-face letters for cross-device consistency.
- Improve the look of the blocks and remove visible gaps between them.
- Redesign the overall presentation so it feels like a serious Wordle-style competitor.
- Improve the presentation of Found Words.
- Replace UI system font stacks with a deliberate web font.
- Get layout working on tablet form.
- Improve word-preview affordances, including the 4+ letters empty state and valid-word highlighting.
- Set up GitHub Pages hosting.
