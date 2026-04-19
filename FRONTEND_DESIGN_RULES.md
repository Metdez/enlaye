# Frontend Design Rules

> Drop this file into any codebase. When generating, refactoring, or reviewing UI, obey every rule below. These are non-negotiable defaults — only deviate if the user explicitly overrides.

---

## 0. Core Principles

- **Signifiers over instructions.** The UI must communicate how it works visually (containers group, active states show selection, disabled states show unavailability). Never rely on explanatory text.
- **Every interaction needs a response.** No silent buttons, no unexplained loading, no missing error states.
- **Hierarchy through contrast.** Size, weight, color, and position create hierarchy — not decoration.
- **Whitespace is a feature.** Room to breathe beats strict grids.
- **Copy proven patterns.** Mirror what top products (Linear, Vercel, Stripe, Notion, Dub) do. Don't invent novel layouts.
- **When shadow/color/animation is the first thing you notice, it's wrong.**

---

## 1. Typography

- **One font family per design.** Clean sans-serif only: Inter, Geist, General Sans, SF Pro, Söhne. Never mix two unless explicitly required.
- **Size scale caps:** landing pages ≤ 6 sizes; dashboards ≤ 24px max (info density).
- **Large text (≥32px):** `letter-spacing: -2%` to `-3%`, `line-height: 110–120%`. This single change makes hero text look pro.
- **Body text:** `line-height: 140–160%`.
- **Weights:** 400 body, 500 UI labels, 600–700 headings. Avoid 800/900 unless display.
- **Never use italics or underline except for links/emphasis in prose.**

---

## 2. Color

- **Start with ONE primary color** (brand). Lighten it for backgrounds, darken it for text. Build a ramp (50–900).
- **Neutrals do 80% of the work.** Most of any UI is gray/white/black.
- **Semantic colors have meaning — use them accordingly:**
  - Blue → info, links, trust
  - Green → success, positive
  - Amber/Yellow → warning
  - Red → error, destructive, danger
- **Color must have purpose.** A colored chip, badge, or dot must *mean* something.
- **Never let AI pick arbitrary bright colors.** If generating palettes, pick muted, desaturated tones and layer sparingly.

### Dark Mode
- Borders: lower contrast (subtle gray, never white).
- **No shadows** — create depth by making cards *lighter* than background.
- Reduce chip/accent saturation 20–30% vs light mode (bright = burns).
- Deep purples, reds, greens are valid — don't default to navy/gray.

---

## 3. Spacing & Layout

- **4pt grid. Everything.** Spacing values must be multiples of 4 (4, 8, 12, 16, 24, 32, 48, 64, 96).
- **32px** = safe default between major sections.
- **Group related elements** tightly (8–16px); separate unrelated generously (32–64px).
- **12-column grid** for structured pages; **8-col tablet**, **4-col mobile**.
- Landing pages can break the grid; **dashboards cannot**.
- **Max content width:** 1200–1440px for marketing; dashboards can be full-width.

---

## 4. Hierarchy

- Most important → **top, large, bold, colorful**.
- Less important → smaller, lower, muted.
- **Images add color and scanability** — use them wherever possible.
- **Right-align** prices, numbers, metadata.
- **Icons + visual lines** (e.g., `Jamesville ──→ Syracuse`) beat "from/to" labels.

---

## 5. Components

### Buttons
- **4 states minimum:** default, hover, active/pressed, disabled. Add loading (spinner) when async.
- **Width ≈ 2× height** for horizontal padding default.
- Primary + secondary CTAs sit side-by-side. Secondary is usually a ghost button.
- **Ghost button** = no background until hover. Use for sidebar links, tertiary actions.
- Rounded corners: 6–10px standard, 999px for pill/tag buttons.

### Inputs
- **States required:** default, hover, focus (colored ring), error (red border + msg), warning, disabled, success (optional).
- **Focus ring is mandatory** — accessibility and signifier.
- Label above, helper text below, error message below in red.
- Keep height consistent with buttons (36/40/44px typical).

### Cards
- Light mode: subtle border **or** soft shadow — not both.
- Dark mode: lighter background than surrounding, no shadow.
- Padding: min 16px, typical 24px.
- Don't pack with 4+ visible buttons — collapse into a `⋯` overflow menu.

### Icons
- **Match icon size to line-height** of adjacent text (24px line-height → 24px icon). Default AI icons are always too big.
- **One icon library per project:** Phosphor, Lucide, Heroicons, or Radix. Never mix.
- **Never use emojis as UI affordances.** Emojis are content, not interface.

### Shadows
- Default framework shadows are too strong. **Lower opacity, higher blur.**
- Cards: subtle or none.
- Popovers/modals/dropdowns: stronger (they float above content).
- **Dark mode: skip shadows entirely.** Use elevation via lighter surfaces.

### Overlays (text on image)
- Never place text on raw imagery.
- Use a **linear gradient** (dark → transparent) behind the text area.
- For premium feel: **progressive blur** layered on top of gradient.

---

## 6. States & Feedback (EVERY data-driven view must have)

- **Empty state** — message + CTA to create first item.
- **Loading state** — skeletons preferred over spinners for content areas.
- **Error state** — clear message + retry action.
- **Success feedback** — toast confirmation for non-visible changes.
- **Disabled state** — grayed, cursor: not-allowed, tooltip explaining why.

---

## 7. Micro-interactions

- Hover: subtle (~2% scale, color shift), 50–150ms.
- Transitions: 150–250ms. `ease-out` for entrances, `ease-in` for exits.
- **Confirmation micro-interactions** — e.g., copy button slides up a "Copied" chip so the user *knows* something happened.
- **Optimistic UI** — update interface instantly on user action, reconcile with server after. Delete, like, toggle must feel instant.

---

## 8. Dashboard Rules

### Sidebar
- Profile/account management: top or bottom corner (use account card, not gradient-letter avatar).
- Primary nav grouped by relevance, icon + short label.
- Secondary items (Settings, Help, Billing) pinned to bottom — collapse related ones together.
- **Active state mandatory** — indicator bar, background fill, or bold.
- Max ~7 top-level items. Nest into dropdowns beyond that.
- Collapsible requires icon-only mode to work at small widths.
- Notification dots / "New" chips are fine here.

### Main Content
- One dashboard = one primary job. Don't dump everything.
- Top bar = page-level actions (create, filter, date range).
- Use grids strictly. 2×2, 3×2, or list layouts.
- Smaller type scale than landing pages.
- **Don't repeat the same KPI block multiple times on one page** (classic AI mistake).

### Tables & Lists
- Separation methods (pick ONE): space, dividers, or background color.
- Must include: search, filter, sort for >10 rows.
- Bulk actions via checkbox → contextual toolbar reveal.
- Row hover state required.
- Empty state built in.

### Charts
- Always include: axis labels, grid lines, legend, range selector, summary value.
- Hover tooltips with exact values.
- Dim non-hovered bars/lines on hover for focus.
- **Stick to standard types:** line, bar, area, donut, map. Don't invent weird chart shapes.

### Modals vs Popovers vs Pages
- **Popover** — simple, non-blocking context (profile menu, display settings). User can click away freely.
- **Modal** — complex action tied to current page (create item, edit). **Blocking** — requires confirm/cancel. Follow with a toast.
- **New page** — permanent/large context (full settings, analytics for one item). Needs back button or breadcrumb.

### Toasts
- Bottom-right or bottom-center.
- Auto-dismiss 4–6s for success; persistent with close button for errors.
- Color-coded semantically.

---

## 9. Landing Pages

- **Presentation = trust.** Quality of visuals drives conversion more than copy length.
- Hero: tight-tracked headline, muted subhead, 1–2 CTAs, strong visual.
- **Graphics > generic icons.** Use real product screenshots, skewed card mockups, illustrated components.
- Social proof early (logos, testimonials).
- Alternating feature sections with real UI screenshots, not stock imagery.
- **Pricing:**
  - 3–4 tiers max. Drop Free/Hobby if unused.
  - Visually highlight the recommended tier.
  - Show what the *next tier adds*, not full feature lists on every card.
  - Display discount amounts ("Save 20%") prominently.
  - Price > tier name in hierarchy (people care about cost, not the label).

---

## 10. Common AI Pitfalls — DO NOT

- ❌ Purple→blue gradient everywhere
- ❌ Emojis as UI icons
- ❌ Gradient circles with initials as avatars
- ❌ Repeating the same KPI block 3× on one page
- ❌ Cluttered cards with 4+ visible buttons (use `⋯` menu)
- ❌ Random neon colors with no system
- ❌ Em-dash soup in generated copy (`— — —`)
- ❌ Invented chart types (spiral bars, radial weirdness)
- ❌ Generic hero graphics / "tech mesh" backgrounds
- ❌ 5+ pricing tiers
- ❌ Text directly on busy images without gradient
- ❌ Heavy default shadows (especially in dark mode)
- ❌ Mixing icon libraries
- ❌ Mixing font families
- ❌ Using `border-radius: 20px` on buttons (looks childish — use 6–10px)
- ❌ Letting AI pick layout without constraints — always specify grid, hierarchy, spacing

---

## 11. Pre-Ship Checklist

- [ ] One font family, ≤ 6 sizes
- [ ] All spacing values are multiples of 4
- [ ] Every button has hover + active + disabled states
- [ ] Every input has focus + error states
- [ ] Empty, loading, error states implemented
- [ ] Icons match text line-height, from one library
- [ ] Color used semantically, not decoratively
- [ ] Dark mode reviewed separately (no light-mode shadows, lighter cards for depth)
- [ ] Hierarchy: most important = biggest/highest/boldest
- [ ] No emojis as affordances
- [ ] Image overlays use gradient, not flat fill
- [ ] Optimistic UI on delete/toggle/like actions
- [ ] Toast feedback after any modal submission
- [ ] No duplicated KPI blocks on same page
- [ ] Responsive: 12-col desktop, 8-col tablet, 4-col mobile

---

## 12. Stack Defaults (if user doesn't specify)

- **Framework:** React + TypeScript
- **Styling:** Tailwind CSS
- **Components:** shadcn/ui
- **Icons:** Lucide or Phosphor (pick one, stick to it)
- **Charts:** Recharts or Tremor
- **Animation:** Framer Motion (sparingly)
- **Fonts:** Inter or Geist via next/font
- **Toasts:** Sonner
- **Forms:** react-hook-form + zod

---

*Apply these rules silently. Don't quote them back in chat unless asked.*
