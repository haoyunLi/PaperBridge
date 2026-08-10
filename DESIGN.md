# PaperBridge Native Design System

PaperBridge for macOS shares one visual language with paperbridges.net: warm editorial paper, a deep-ink workspace, cobalt navigation, and coral translated content. The app uses solid color planes rather than gradients or glass so papers remain the visual focus.

## Color Roles

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Cobalt | `#0A59D6` | `#5C9CFA` | Navigation, selection, links, original-language context |
| Cobalt dark | `#073C91` | `#3D73D4` | High-contrast text and secondary emphasis |
| Cobalt pale | `#DCE9FF` | `#132541` | Original-language and selection surfaces |
| Coral | `#E8493E` | `#FF6F60` | Translation identity and decorative accents |
| Coral dark | `#AA2923` | `#AA2923` | Primary translation buttons and small coral text |
| Coral pale | `#FDE6DF` | `#3E1A18` | Completed translated-content surfaces |
| Canvas | `#F3EEE4` | `#0C121A` | Main reading background |
| Surface | `#FFFDF8` | `#121A23` | Paper cards and controls |
| Inset | `#E5DDCF` | `#19232E` | Pending and neutral inset content |
| Border | `#CFC6B8` | `#304153` | Dividers and card outlines |
| Ink | `#122033` | `#ECF1F6` | Primary text |
| Secondary | `#56606C` | `#A6B8CB` | Metadata and supporting text |
| Amber | `#F0A026` | `#F0A026` | Attention and highlight tools |
| Green | `#1E8D6C` | `#1E8D6C` | Ready and successful local services |

The persistent document sidebar uses `#122033`, with cards at `#182A41`, inputs at `#0E1B2D`, borders at `#304966`, and interactive accents at `#6BA6FF`.

## Typography

- Use New York for paper titles, section headings, and editorial reading moments.
- Use San Francisco for controls, navigation, status, and metadata.
- Use New York Regular at 16 points with 5 points of line spacing for native paper text.
- Render Markdown at 17 pixels with approximately 1.68 line height.
- Use SF Mono only for model names, paths, URLs, and technical values.

## Layout

- Default window: `1320 x 820`; minimum window: `980 x 620`.
- Document sidebar: 264-348 points, ideal 294.
- Reading column: approximately 980-1020 points where space permits.
- At 1180 points and wider, Research Inspector appears at the trailing edge, 280-420 points with an ideal width of 330.
- Below 1180 points, Research Inspector becomes a bottom drawer with two independently scrolling columns.
- Keep the main reader at least 320 points tall when the bottom drawer is open.

## Components

- Sidebar cards use a 12-point radius and 14-point internal padding.
- Reading surfaces use a 14-point radius and a visible warm-gray border.
- Active workspace navigation uses a solid cobalt plane.
- Coral pale is reserved for completed translation content. Pending translation stays neutral.
- Inspector source results use cobalt pale; translation results use coral pale.
- Highlights use exact amber, cobalt, and coral brand tokens.
- Keep standard macOS title bars, menus, focus behavior, scrolling, and keyboard shortcuts.

## Logo

The mark is a cobalt rounded tile containing a warm-white open book with a coral center seam. It is drawn with SwiftUI Canvas at runtime and exported at every required macOS app-icon size. Do not add gradients, flags, arrows, or language letters.

Run `scripts/generate_brand_assets.swift` whenever the logo geometry or brand colors change, then verify both the Dock icon and the smallest 16-point asset.

## Future Rules

- Preserve the distinction between cobalt source context and coral translated content.
- Add colors through `PaperBridgeTheme`, not one-off system colors.
- Keep the native app, Markdown preview, exported icons, and website synchronized.
- Build recurring UI with shared card, badge, and label components.
- Keep transitions brief and disable nonessential motion when Reduce Motion is enabled.
- Test the minimum size, 1180-point breakpoint, default size, dark mode, and populated selection states before release.
- Do not imply cloud processing: local-first behavior must remain visually and verbally explicit.
