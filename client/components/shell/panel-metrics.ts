// The module panel's width, and the gutter the chrome keeps clear for it.
//
// Defined together because they are one measurement seen from two sides: the
// panel paints over the chrome (z-30 against the header's z-20), so if the
// gutter ever stopped matching the rail, the Data / Terminal / account buttons
// would slide back under it — which is the bug this pair exists to prevent.
//
// Whole class strings rather than a number, so Tailwind's scanner can see them.
// Both carry the `md:` prefix because the rail itself is `md:block`: below that
// breakpoint there is no panel and nothing to reserve.

export const MODULE_PANEL_W = "md:w-[320px]"
export const MODULE_PANEL_PR = "md:pr-[320px]"
