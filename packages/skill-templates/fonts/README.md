# Fonts

The app's three faces, Latin only, as Google Fonts serves them: Instrument Sans (variable weight and width), Unbounded 400 and Geist Mono (variable weight). All three are under the SIL Open Font License 1.1.

A Mockup loads nothing from the network, so `lib/fonts.ts` writes them into each App Skill as `fonts.css`, with the files as data URLs, and the template's data page links it with a `skill:` reference.
