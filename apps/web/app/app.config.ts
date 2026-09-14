export default defineAppConfig({
  ui: {
    // Stock Nuxt UI v4 recipes (Figma "Nuxt UI v4 (Community)"). The only
    // theme inputs are the brand primary (derived at runtime from the
    // institution colour in settings, see utils/brandTheme.ts) and the
    // neutral palette. Do not add size, radius, shadow or slot recipes here;
    // a deliberate customisation is documented in DESIGN.md first.
    colors: { primary: 'brand', neutral: 'slate' },
    // Floating layers only: they must sit above the shell's fixed sidebars.
    selectMenu: { slots: { content: 'z-[var(--nasq-ui-z-menu)]' } },
    select: { slots: { content: 'z-[var(--nasq-ui-z-menu)]' } },
    dropdownMenu: { slots: { content: 'z-[var(--nasq-ui-z-menu)]' } },
    tooltip: { slots: { content: 'z-[var(--nasq-ui-z-menu)]' } },
    popover: { slots: { content: 'z-[var(--nasq-ui-z-menu)]' } },
    slideover: { slots: { content: 'z-[var(--nasq-ui-z-sheet)]' } },
    modal: { slots: { content: 'z-[80]', overlay: 'z-[79]' } },
  },
})
