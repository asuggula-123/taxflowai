# Tax Document Intake Application - Design Guidelines

## Design Approach
**Selected Framework:** Design System Approach - Linear-Inspired Productivity Application

**Justification:** This is a utility-focused, information-dense productivity tool for accountants requiring efficiency, clarity, and professional aesthetics. Drawing from Linear's clean, purposeful design philosophy combined with enterprise-grade reliability.

**Core Principles:**
- Professional clarity over visual flair
- Information density without clutter  
- Consistent, predictable interactions
- Status-driven visual hierarchy

## Color Palette

**Dark Mode Primary (Default):**
- Background Base: 220 13% 9%
- Background Elevated: 220 13% 11%
- Background Subtle: 220 10% 15%
- Border Default: 220 13% 20%
- Border Emphasis: 220 13% 28%

**Light Mode Primary:**
- Background Base: 0 0% 100%
- Background Elevated: 220 13% 98%
- Background Subtle: 220 13% 95%
- Border Default: 220 13% 88%
- Border Emphasis: 220 13% 80%

**Semantic Colors (Both Modes):**
- Status Ready: 142 76% 36% (Green)
- Status Incomplete: 38 92% 50% (Amber)
- Status Not Started: 217 91% 60% (Blue)
- Error/Reject: 0 84% 60% (Red)
- Text Primary: 220 9% 95% (dark) / 220 9% 15% (light)
- Text Secondary: 220 9% 65% (dark) / 220 9% 45% (light)

## Typography

**Font Families:**
- Primary: 'Inter', system-ui, sans-serif (via Google Fonts CDN)
- Monospace: 'JetBrains Mono', monospace (for document names, IDs)

**Type Scale:**
- Page Titles: text-2xl font-semibold (24px)
- Section Headers: text-lg font-medium (18px)
- Body Text: text-sm (14px)
- Captions/Meta: text-xs (12px)
- Document Names: text-sm font-mono

**Line Heights:** leading-tight for headings, leading-normal for body text

## Layout System

**Spacing Primitives:** Constrained to Tailwind units of 2, 4, 6, 8, 12, 16 for consistency
- Micro spacing (gaps, padding): 2-4
- Component spacing: 4-6
- Section spacing: 8-12
- Page-level margins: 16

**Grid Structure:**
- Customer List: Full width with max-w-7xl container
- Customer Detail Split: 
  - Top row: 2-column grid (40% docs left, 60% details right)
  - Bottom row: Full width chat interface (minimum 40vh)
- Responsive: Stack to single column on mobile (below md breakpoint)

## Component Library

### Navigation & Header
- Top bar: Sticky header with app title left, user menu right
- Height: h-14, border-b with subtle shadow
- Customer detail: Breadcrumb navigation (Home > Customer Name)

### Customer List Dashboard
- Card-based list items with hover states (bg-subtle on hover)
- Each card: Name prominent, email secondary, status badge right-aligned
- Status badges: Pill-shaped with corresponding semantic colors, text-xs px-3 py-1
- Add customer button: Primary CTA, top-right corner, icon + "Add Customer"
- Empty state: Centered illustration with "No customers yet" message

### Add Customer Modal
- Centered overlay with backdrop blur
- Form fields: Name (text input), Email (email input) 
- Stack vertically with space-y-4
- Actions: Cancel (ghost) + Create (primary), right-aligned

### Customer Detail Page

**Document List (Top Left):**
- Compact card layout with document icon (Heroicons: DocumentTextIcon)
- Document name in mono font, status badge (Requested/Completed)
- Requested docs: Dashed border with amber accent
- Completed docs: Solid border with green accent
- Scrollable container with max-h-96

**Customer Details (Top Right):**
- Key-value pairs in definition list format
- Labels: text-xs text-secondary uppercase tracking-wide
- Values: text-sm text-primary
- Sections: Personal Info, Income Sources, Deductions (auto-populated)
- Empty fields show "—" placeholder
- Scrollable container matching docs height

**Chat Interface (Bottom):**
- Message bubbles: Accountant (right-aligned, bg-emphasis) vs AI (left-aligned, bg-subtle)
- Timestamp: text-xs text-secondary below each message
- Input area: Fixed at bottom with drag-drop zone
- Drag-drop zone: Dashed border, blue accent when active, icon + "Drop documents here"
- File upload indicator: Show uploading spinner, then AI "analyzing..." state
- AI responses: Conversational tone, markdown support for lists

### Status Flow Indicators
- Visual progression bar at top of customer detail (3 dots: Not Started > Incomplete > Ready)
- Active state: Filled circle with primary color
- Completed states: Check icon in circle
- Lines connecting states with color transition

## Interactions & Animations

**Minimal Animation Philosophy:**
- State transitions: 150ms ease-in-out for color/border changes
- Modal/overlay: 200ms fade + scale (0.95 to 1)
- Document upload: Smooth progress bar fill
- No decorative animations, hover effects only

**Drag & Drop:**
- Visual feedback: Border color change + scale(1.02) on drag-over
- Drop success: Brief green border flash before upload starts
- Rejection: Red border flash with shake animation (translate-x-1 back and forth)

## Accessibility

- ARIA labels on all interactive elements
- Focus states: 2px ring-offset with primary color ring
- Keyboard navigation: Tab order follows visual hierarchy
- Color contrast: WCAG AAA compliant for text
- Screen reader announcements for status changes

## Responsive Breakpoints

- Mobile (< 768px): Single column, stacked layout, chat takes 50vh minimum
- Tablet (768px - 1024px): Maintain 2-column top split, reduce spacing to 4-6
- Desktop (> 1024px): Full 3-section layout with spacing-8

## Professional Polish

- Consistent 2px rounding on all cards/inputs (rounded-md)
- Subtle elevation: Use border + shadow-sm on elevated surfaces
- Monospace fonts for data that should align (IDs, document names)
- Loading skeletons for async content (pulsing bg-subtle rectangles)
- Toast notifications for actions: "Customer added", "Document uploaded", "Status updated to Ready"