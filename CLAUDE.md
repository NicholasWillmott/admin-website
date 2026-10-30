# Admin-Website

SolidJS + Vite admin dashboard for the FASTR fleet (frontend in `src/frontend`, backend in `src/backend`).

## UI rules (read before touching any markup or CSS)

The UI is built from a small set of shared pieces. New screens reuse them; they don't invent their own.

- **Read `STYLE_GUIDE.md` first.** It is the source of truth for colours, type, spacing and components.
- **Buttons: always `<Button>`** from `src/frontend/components/ui/Button.tsx`. Never write a styled `<button class="…-btn">` or a new button class.
  - `variant`: `primary` (the main or confirming action, at most one per panel/dialog), `neutral` (default), `caution` (restart, stop), `danger` (delete, remove).
  - `size="sm"` in table rows and dense toolbars; `block` for the two buttons of a modal footer; `loading` for in-flight actions (keep `disabled` too).
  - Sentence-case labels: "Create server", not "Create Server". Use "…" not "...".
- **Icons: always `<Icon name="…">`** from `src/frontend/components/ui/Icon.tsx`. Never use emoji or text glyphs (✕ ✓ ▶ ▾ 👤) as icons. If an icon is missing, add its 24×24 stroke path to `PATHS` there.
- **Colours, radii, font sizes: only `var(--…)` tokens** from `src/frontend/css/tokens.css`. No raw hex values outside `tokens.css`; add a token if a genuinely new colour is needed.
- **Things that make the app look generated — don't add them:** gradients on buttons or surfaces, hover effects that move/scale/glow (`transform` on `:hover`), `transition: all`, coloured left-border "accent" cards, uppercase letter-spaced text outside small section labels.
- **Inline `style=`** is for one-off layout (flex, gap, width) only, never colours or typography.
- Exempt: the module editor (`components/views/ModuleDefinitions/`) keeps its own light/dark code-editor themes.

## Checks

- `npm run build` — type-check + build (must pass).
- `npm run lint:css` — stylelint. Errors fail; warnings are legacy `App.css` debt to burn down, don't add more.
