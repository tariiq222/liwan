export default defineAppConfig({
  ui: {
    // Nuxt UI v4 stock recipes plus ONE calm, modern polish layer. Every recipe
    // below is listed in DESIGN.md «وصفات الثيم المعتمدة»; this file is the only
    // place recipes may live. Colours: brand primary from settings
    // (utils/brandTheme.ts) and the slate neutral palette.
    colors: { primary: 'brand', neutral: 'slate' },

    // Controls: 0.5rem radius (see --ui-radius), gentle 150ms colour
    // transitions, a whisper of shadow on the one primary action.
    button: {
      slots: { base: 'rounded-lg transition-colors duration-150' },
      compoundVariants: [{ color: 'primary', variant: 'solid', class: 'shadow-xs' }],
    },
    input: { slots: { base: 'rounded-lg bg-elevated/30' } },
    inputNumber: { slots: { base: 'rounded-lg bg-elevated/30' } },
    textarea: { slots: { base: 'rounded-lg bg-elevated/30' } },
    select: { slots: { base: 'rounded-lg bg-elevated/30', content: 'z-[var(--nasq-ui-z-menu)] rounded-xl shadow-lg ring-default/60' } },
    selectMenu: { slots: { base: 'rounded-lg bg-elevated/30', content: 'z-[var(--nasq-ui-z-menu)] rounded-xl shadow-lg ring-default/60' } },

    // Surfaces: softer corners, a hairline shadow instead of a hard ring,
    // quiet card headers.
    card: { slots: { root: 'rounded-xl shadow-xs', header: 'bg-muted/40', body: 'p-4 sm:p-5', footer: 'bg-muted/20' } },
    table: {
      slots: {
        th: 'text-xs font-medium text-muted',
        tr: 'transition-colors hover:bg-muted/50 data-[selected=true]:bg-primary/5',
      },
    },

    // Status and progress read as pills.
    badge: { slots: { base: 'rounded-full' } },
    progress: { slots: { base: 'rounded-full', indicator: 'rounded-full' } },
    avatar: { slots: { root: 'ring-2 ring-bg' } },
    tabs: { slots: { list: 'rounded-lg', indicator: 'rounded-md shadow-xs', trigger: 'rounded-md' } },

    // Floating layers: above the shell's fixed sidebars, softer and lifted.
    dropdownMenu: { slots: { content: 'z-[var(--nasq-ui-z-menu)] rounded-xl shadow-lg ring-default/60' } },
    popover: { slots: { content: 'z-[var(--nasq-ui-z-menu)] rounded-xl shadow-lg ring-default/60' } },
    tooltip: { slots: { content: 'z-[var(--nasq-ui-z-menu)] rounded-lg' } },
    slideover: { slots: { content: 'z-[var(--nasq-ui-z-sheet)]' } },
    modal: { slots: { content: 'z-[80] rounded-2xl shadow-xl', overlay: 'z-[79] backdrop-blur-xs' } },
  },
})
