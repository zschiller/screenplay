# Draw a Mockup or Document

- Original: https://claude.ai/artifact/3vjbbZYYLBLczPxpSf33YG
- Date: 2026-10-07 (last updated)
- Issue: [#1890](https://github.com/zschiller/screenplay/issues/1890) (spec #1882)

> “Drawing a Mockup or Document should follow the frame picker/create pattern, but inverted: the prompt comes first, and you can back out to open an existing file in the drawn box.”

**Question:** How does the card on a drawn Mockup or Document box get from the prompt to opening an existing file?

**Outcome:** A picked (Open button beside Send), with Zack’s changes: “i think esc. covers the ‘write it myself’ case fine. can we make the open button more explicit and go w/ A”, then “should there be a kb shortcut for open too”. Built as a text button, Open mockup / Open document, with ⌘O; the Document card’s Write it myself button went (Esc still writes it by hand).

**Not picked:** B, an Open row pinned under the prompt; C, Esc backing out to the file search.

Snapshot of the exploration page; open index.html locally (it loads captures from the sibling folders).
