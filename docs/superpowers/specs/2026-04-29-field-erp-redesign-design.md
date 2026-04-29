# Field ERP Redesign Design

## Direction

Use a field-control ERP direction: the application should feel like a daily construction operations system, not a generic SaaS dashboard.

## Design Rules

- Use a dark industrial sidebar and a quiet work-surface background.
- Reduce rounded corners to 4-8px.
- Remove soft card shadows in operational screens.
- Prefer borders, status color, dense tables, and toolbars over decorative cards.
- Keep Pretendard as the UI font, but reduce oversized headings and heavy dashboard hierarchy.
- Use safety yellow, status green, warning amber, and alert red as functional accents.

## Pilot Scope

- App shell and desktop/mobile navigation.
- Home dashboard visual language.
- Additional work scan/extraction workbench.

## Non-Goals

- Do not change extraction, OCR, Vision, payroll, Firestore, or Excel logic.
- Do not redesign every table-heavy module in this first pass.
- Do not introduce a new component library.
