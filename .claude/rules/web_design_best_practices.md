---
paths:
  - "frontend/**/*.{ts,tsx,css}"
---


# Web design best practices

- **Available MCP servers in this workspace:** `context7`, `perplexity`, `playwright`, `puppeteer`, `sequential-thinking`, `repomix`, `mermaid`.
- **Figma guidance (conditional):** if a Figma MCP server is available in the workspace *and* the user shares a `figma.com` URL or explicitly asks for visual parity with a design, pull design context from Figma first before coding. Otherwise, proceed from the user's description, existing components, and the principles below.
- **Design-to-code workflow:** extract design intent first (spacing, type scale, color roles, component hierarchy), then adapt it to the project's existing components, tokens, and layout primitives instead of pasting raw generated markup.
- **Use `context7` for Tailwind/library docs:** confirm current utility syntax, responsive behavior, dark-mode strategy, and framework integration details before changing implementation patterns. Do not assume class names from memory.
- **Use `perplexity` for current UX guidance:** rely on it for web-grounded best practices around accessibility, forms, hierarchy, responsiveness, motion, and contemporary UI conventions. Use `perplexity_ask` for quick questions and `perplexity_research` for deeper investigation.
- **High-level principle:** build interfaces that are clear, calm, accessible, and consistent before making them visually clever.

## High-level tips

- Use a clear visual hierarchy with a small type scale, restrained font weights, and predictable spacing steps.
- Start with one strong primary action per surface; secondary and destructive actions should read clearly but not compete.
- Use whitespace as structure. Prefer consistent `gap-*`, `space-*`, and container padding over ad hoc `mt-*` nudges.
- Keep layouts mobile-first and content-first. Small screens should feel intentional, not compressed desktop layouts.
- Preserve accessibility in every design pass: strong contrast, visible focus states, semantic structure, descriptive labels, and touch-friendly targets.
- Keep motion subtle and purposeful. Respect reduced-motion preferences (`motion-reduce:`) and avoid decorative animation that competes with content.

## In-depth principles

- **Hierarchy:** page titles, section headers, body text, labels, helper text, and metadata should each have a repeatable pattern. Do not invent a new treatment for every screen.
- **Spacing system:** prefer the Tailwind spacing scale and a few recurring layout rhythms — dense, normal, and roomy. Consistency matters more than perfect pixel matching.
- **Typography:** use Tailwind's type scale and line-height utilities to support scanning. Favor readable body text and short, information-rich headings over oversized hero styling in app UI.
- **Color system:** define semantic colors and state colors in shared tokens (Tailwind config `theme.extend.colors`). Color should communicate role and status, not serve as the only cue.
- **States:** every interactive component needs default, hover, focus, active, disabled, and dark-mode treatments. Keyboard focus must remain obvious — never suppress the focus ring without providing an equivalent.
- **Forms:** labels, helper text, errors, and validation states should be visually related and easy to scan. Errors should be specific and descriptive, and must never rely on color alone.
- **Responsiveness:** use unprefixed utilities for the base (mobile) experience and layer responsive prefixes up. Re-check line length, card density, truncation, and tap targets at each breakpoint.
- **Layout primitives:** build from stable shells — page containers, section wrappers, stack rows, grids, cards, and panels. Reuse those primitives across screens instead of re-specifying layout per page.
- **Component reuse:** repeated design patterns should become shared React components or variants in `frontend/src/components/`, not copied class piles. Tailwind should reinforce a system, not create drift.
- **Dark mode parity:** dark mode is not just an inverted palette. Preserve contrast, elevation cues, border visibility, and the relative prominence of primary actions in both themes.
- **Content density:** app screens should feel efficient, but never crowded. If a section feels busy, simplify hierarchy before shrinking spacing or font sizes.
- **Design fidelity with judgment:** when a reference design and the codebase differ, preserve the design intent while adapting to the existing token system, accessibility needs, and reusable components.

## Tailwind implementation guardrails

- Prefer utility classes over one-off CSS, but keep class lists disciplined and token-aligned.
- Avoid arbitrary values (`w-[347px]`, `text-[13px]`) unless the design truly requires a value that no shared token covers.
- Keep Tailwind classes static and explicit; map state-dependent styles to full class strings in lookup objects, not dynamically assembled fragments.
- When implementing a design, match spacing, hierarchy, states, and responsiveness first; exact decorative polish comes after structure and usability are correct.
- Verify meaningful UI changes in a browser with `playwright` when possible, especially for responsive layouts, forms, keyboard focus, and theme switching. Use `puppeteer` as an alternative when Playwright is not available.
