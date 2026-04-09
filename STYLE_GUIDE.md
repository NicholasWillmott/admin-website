# Admin Website — UI Style Guide

This document defines the visual conventions used throughout the app. **Always refer to this before writing or editing any CSS, SVG, or inline styles.**

---

## Colour Palette

### Backgrounds
| Role | Value |
|---|---|
| Page / view background | `#243d2e` |
| Card / block background | `rgba(255, 255, 255, 0.04)` |
| Card background (expanded/elevated) | `rgba(255, 255, 255, 0.06)` |
| Subtle inner section | `rgba(255, 255, 255, 0.02)` |
| Modal background | `#1a2e22` |
| Dark base (non-view areas) | `#070f10` |

### Text
| Role | Value | Usage |
|---|---|---|
| Primary | `#e2e8f0` | Headings, key labels, server names, modal titles |
| Body | `#cbd5e1` | Table cells, form values, general content |
| Secondary / muted | `#94a3b8` | Stats, subtitles, metadata, graph axis labels, form labels |
| De-emphasised (table headers only) | `#64748b` | Uppercase column headers, section dividers — **not** for body text |
| Accent | `#5eead4` | Highlighted names, active links, monospace paths, active states |
| Positive / success | `#4ade80` | Sizes, costs, success values |
| Warning | `#f59e0b` / `#fbbf24` | Usage warnings, amber alerts |
| Error | `#f87171` | Error messages, danger labels |
| Pending / inactive | `#64748b` | Pending step labels, disabled states |

> **Rule:** `#64748b` is reserved for uppercase table column headers. Everything else uses `#94a3b8` or brighter.

### Borders
| Role | Value |
|---|---|
| Standard card / container border | `rgba(255, 255, 255, 0.1)` |
| Subtle inner border | `rgba(255, 255, 255, 0.06)` |
| Very subtle separator | `rgba(255, 255, 255, 0.05)` |
| Hover / focus border | `#0d9488` |
| Dashed divider | `rgba(255, 255, 255, 0.12)` |

### Brand / Interactive
| Role | Value |
|---|---|
| Primary teal | `#0d9488` |
| Primary teal dark | `#065f59` |
| Primary gradient | `linear-gradient(135deg, #0d9488 0%, #065f59 100%)` |
| Teal glow (shadow) | `rgba(13, 148, 136, 0.3)` |
| Active teal highlight | `#0e706c` |

### Status
| Role | Value |
|---|---|
| Online / success | `#22c55e` |
| Warning (75–89% usage) | `#f59e0b` |
| Danger / high usage (90%+) | `#ef4444` |
| Offline / error | `#f87171` |
| Pending | `#ffc107` |

---

## Typography

### View / Page Titles
```css
font-size: 1rem;
font-weight: 700;
letter-spacing: 0.15em;
text-transform: uppercase;
color: #e2e8f0;
opacity: 0.9;
```

### Table Column Headers
```css
font-size: 11px;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.08em;
color: #64748b;
```

### Section Sub-headers (inside cards)
```css
font-size: 11px;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.1em;
color: #94a3b8;
```

### Monospace (paths, IDs, versions)
```css
font-family: 'Monaco', 'Courier New', monospace;
color: #5eead4;
```

---

## Cards & Blocks

```css
background: rgba(255, 255, 255, 0.04);
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 10px;
padding: 20px 24px;
```

Hover or expanded state — use `rgba(255, 255, 255, 0.06)`.

---

## Tables

```css
/* Container */
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 10px;
background: rgba(255, 255, 255, 0.04);

/* Header row */
background: rgba(255, 255, 255, 0.06);
border-bottom: 1px solid rgba(255, 255, 255, 0.1);

/* Body rows */
border-bottom: 1px solid rgba(255, 255, 255, 0.05);

/* Row hover */
background: rgba(255, 255, 255, 0.04);

/* Cell text */
color: #cbd5e1;

/* Important cell (name, label) */
color: #e2e8f0;

/* Muted cell (date, path, secondary) */
color: #94a3b8;
```

---

## Buttons

### Primary
```css
background: linear-gradient(135deg, #0d9488 0%, #065f59 100%);
color: white;
border: none;
```

### Secondary (default action)
```css
background: rgba(255, 255, 255, 0.06);
border: 1px solid rgba(255, 255, 255, 0.15);
color: #cbd5e1;
border-radius: 8px;
```
Hover: `border-color: #0d9488; color: #5eead4;`

### Danger
```css
background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
color: white;
border: none;
```

### Disabled
```css
opacity: 0.5;
cursor: not-allowed;
```

---

## Form Inputs & Selects

```css
background: rgba(255, 255, 255, 0.06);
border: 1px solid rgba(255, 255, 255, 0.15);
border-radius: 6–8px;
color: #cbd5e1;
font-size: 14px;
```

Focus state:
```css
border-color: #0d9488;
box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.15);
outline: none;
```

Placeholder:
```css
color: #64748b;
```

Labels above inputs:
```css
font-size: 11–13px;
font-weight: 600;
color: #94a3b8;
text-transform: uppercase;   /* optional for small labels */
letter-spacing: 0.08em;
```

---

## Modals

```css
/* Overlay */
background: rgba(0, 0, 0, 0.7);

/* Modal box */
background: #1a2e22;
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 12px;
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);

/* Header */
border-bottom: 1px solid rgba(255, 255, 255, 0.1);

/* Title (in header) */
color: #e2e8f0;
font-size: 1rem;
font-weight: 700;
letter-spacing: 0.12em;
text-transform: uppercase;

/* Close button */
color: #64748b;
/* hover → background: rgba(255,255,255,0.08); color: #e2e8f0 */
```

---

## Graphs & SVG Charts

### Container
Same as card — `rgba(255, 255, 255, 0.04)` background, `rgba(255, 255, 255, 0.1)` border.

### SVG Elements
| Element | Value |
|---|---|
| Grid / guide lines | `stroke="rgba(255,255,255,0.08)"` |
| Axis tick labels | `fill="#94a3b8"` |
| Bar / line (primary) | `#0e706c` (fill) or `stroke="#0e706c"` |
| Area fill | `fill="#0e706c" fill-opacity="0.08"` |
| Empty / zero bar or cell | `rgba(255, 255, 255, 0.06–0.08)` |
| Data point dot (zero) | `rgba(255, 255, 255, 0.15)` |

### Tooltips (SVG)
```jsx
<rect fill="#1a2e22" stroke="rgba(255,255,255,0.2)" stroke-width="1" rx="4" />
<text fill="#e2e8f0" font-size="10" font-weight="500" />
```

### Toggle buttons (month/year/filter)
```css
/* Container */
background: rgba(255, 255, 255, 0.06);
border-radius: 6px;
padding: 3px;

/* Button */
color: #64748b;
background: transparent;

/* Active */
background: rgba(255, 255, 255, 0.1);
color: #e2e8f0;
font-weight: 600;
```

### Year selects
```css
background: rgba(255, 255, 255, 0.06);
border: 1px solid rgba(255, 255, 255, 0.12);
color: #94a3b8;
border-radius: 6px;
```

---

## Loading & Empty States

```css
color: #94a3b8;
/* Centred, with spinner if async */
```

Spinner:
```css
border: 4px solid rgba(255, 255, 255, 0.08);
border-top: 4px solid #0d9488;
border-radius: 50%;
animation: spin 1s linear infinite;
```

---

## Alerts & Notes

| Type | Background | Border | Text |
|---|---|---|---|
| Warning / amber | `rgba(245, 158, 11, 0.08)` | `rgba(245, 158, 11, 0.3)` left-4px | `#fbbf24` |
| Error | `rgba(239, 68, 68, 0.08)` | `rgba(239, 68, 68, 0.3)` left-4px | `#f87171` |
| Info / teal | `rgba(13, 148, 136, 0.08)` | `rgba(13, 148, 136, 0.3)` left-4px | `#5eead4` |

---

## Usage Bar (progress indicators)

```css
/* Track */
background: rgba(255, 255, 255, 0.08);
border-radius: 999px;
height: 10px;

/* Fill colour by threshold */
< 75%  → #22c55e
75–89% → #f59e0b
≥ 90%  → #ef4444
```

---

## Badges & Tags

```css
/* Default teal badge */
background: linear-gradient(135deg, #0d9488 0%, #065f59 100%);
color: white;
border-radius: 20px;
padding: 6px 12px;
font-size: 12px;
font-weight: 600;
```

---

## Spacing & Shape

| Property | Value |
|---|---|
| Card border-radius | `10px` |
| Modal border-radius | `12px` |
| Button border-radius | `8px` |
| Input border-radius | `6–8px` |
| Small tag border-radius | `4–6px` |
| Standard card gap | `24px` |
| Section padding | `20px 24px` |
