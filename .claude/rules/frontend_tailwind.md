---
paths:
  - "frontend/**/*.{ts,tsx,css}"
---


# Tailwind frontend conventions

- **Research first:** use Context7 for Tailwind, Vite, Vitest, and Testing Library docs before assuming APIs or setup. Do not rely on memory for version-specific utility names, plugin config, or test-helper signatures.
- **Build utility-first:** prefer Tailwind utilities directly in JSX/TSX components; do not reach for custom CSS or `@apply` just to hide class lists. Reserve `@apply` for truly shared, non-component patterns (e.g. base prose styles in a global CSS file).
- **Prefer semantic HTML:** use real `button`, `a`, `form`, `label`, `nav`, `main`, `section`, and correct ARIA roles and attributes before reaching for styling concerns. Semantic structure is required, not optional.
- **Keep states explicit:** hover, focus-visible, active, disabled, loading, and dark mode should be represented in both UI logic and styles. A disabled button must look and behave disabled; a loading state must be communicated to assistive technology.
- **Use static class names:** do not build Tailwind classes from string fragments — writing `bg-${color}-500` or `` `text-${size}` `` will cause Tailwind's content scanner to miss the class and produce no output. Map variants to full static strings instead:
  ```tsx
  // Bad
  const cls = `bg-${status}-500`;

  // Good
  const statusClass = { success: "bg-green-500", error: "bg-red-500" }[status];
  ```
- **Testing rule:** frontend tests should assert **behavior, accessibility, and visible state**, not long Tailwind class strings. Query by role, label, or test-id; fire events; assert text and ARIA attributes.
- **Class assertions should be selective:** only assert a class when it encodes meaningful behavior — `hidden`, `sr-only`, `dark:*`, responsive visibility (`sm:hidden`, `md:block`), or interactive state variants (`disabled:opacity-50`). Do not snapshot the full class list.
- **Do not over-mock UI:** keep component rendering real; mock only network calls (via MSW or similar) or browser APIs (IntersectionObserver, ResizeObserver) at the boundary. Testing Library's `render` should receive the real component tree.
- **Browser verification:** for substantial UI work — new layouts, forms, dark-mode additions, responsive breakpoint changes — use Playwright to verify focus behavior, responsive rendering, and theme switching. Do not rely on unit tests alone for visual or interactive correctness.
- **See also:** `.claude/rules/testing_frontend.md` for the dedicated frontend testing standard.
