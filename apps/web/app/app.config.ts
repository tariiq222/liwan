export default defineAppConfig({
  ui: {
    // Tasmim recipes (DESIGN.md «وصفات الثيم المعتمدة»). Colours: tenant primary
    // from settings (utils/brandTheme.ts), slate neutral, Nasq midnight/lime in
    // tokens.css. Sizes come from tokens: --nasq-control-h, --nasq-row-h,
    // --ui-radius (rounded-md = 6px, rounded-lg = 8px at the 14px root).
    colors: { primary: 'brand', neutral: 'slate' },

    // The 32px control floor applies to the default (md) size only; xs/sm stay compact.
    // Dark mode: the solid primary paints from --primary-solid (brandTheme.ts darkSolid), not the
    // greyed --brand-link that text-primary and focus keep (owner amendment 4, CP2).
    button: { slots: { base: 'rounded-md transition-colors duration-150 motion-reduce:transition-none' }, variants: { size: { md: { base: 'min-h-(--nasq-control-h)' } } }, compoundVariants: [{ size: 'md', square: true, class: 'min-w-(--nasq-control-h)' }, { color: 'primary', variant: 'solid', class: 'dark:bg-(--primary-solid) dark:text-(--primary-solid-foreground) dark:hover:bg-(--primary-solid-hover) dark:hover:text-(--primary-solid-hover-foreground) dark:active:bg-(--primary-solid-hover) dark:active:text-(--primary-solid-hover-foreground) dark:disabled:bg-(--primary-solid) dark:aria-disabled:bg-(--primary-solid)' }] },
    input: { slots: { base: 'rounded-md bg-default' }, variants: { size: { md: { base: 'min-h-(--nasq-control-h)' } } } },
    inputNumber: { slots: { base: 'rounded-md bg-default' }, variants: { size: { md: { base: 'min-h-(--nasq-control-h)' } } } },
    textarea: { slots: { base: 'rounded-md bg-default' } },
    select: { slots: { base: 'rounded-md bg-default', content: 'z-[var(--nasq-ui-z-menu)] rounded-lg shadow-lg ring ring-default' }, variants: { size: { md: { base: 'min-h-(--nasq-control-h)' } } } },
    selectMenu: { slots: { base: 'rounded-md bg-default', content: 'z-[var(--nasq-ui-z-menu)] rounded-lg shadow-lg ring ring-default' }, variants: { size: { md: { base: 'min-h-(--nasq-control-h)' } } } },

    // Surfaces: hairline ring, no resting shadow, compact padding.
    card: { slots: { root: 'rounded-lg ring ring-default shadow-none', header: 'px-4 py-3 sm:px-4', body: 'p-3 sm:p-4', footer: 'px-4 py-3 sm:px-4' } },
    table: {
      slots: {
        th: 'h-(--nasq-row-h) px-3 py-0 text-xs font-medium text-muted',
        td: 'h-(--nasq-row-h) px-3 py-0 text-sm',
        tr: 'transition-colors hover:bg-elevated/50 data-[selected=true]:bg-primary/5',
      },
    },

    // Light mode: the 500 step on its 10% tint fails 4.5:1 (success 2.0, warning 1.8, error 3.3), so subtle/soft
    // text uses the 800 step; dark mode keeps the stock 400 step. primary/neutral are brand/slate and already pass.
    badge: { slots: { base: 'rounded-md' }, compoundVariants: [{ color: 'secondary', variant: 'soft', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'soft', class: 'text-success-800 dark:text-success' }, { color: 'info', variant: 'soft', class: 'text-info-800 dark:text-info' }, { color: 'warning', variant: 'soft', class: 'text-warning-800 dark:text-warning' }, { color: 'error', variant: 'soft', class: 'text-error-800 dark:text-error' }, { color: 'secondary', variant: 'subtle', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'subtle', class: 'text-success-800 dark:text-success' }, { color: 'info', variant: 'subtle', class: 'text-info-800 dark:text-info' }, { color: 'warning', variant: 'subtle', class: 'text-warning-800 dark:text-warning' }, { color: 'error', variant: 'subtle', class: 'text-error-800 dark:text-error' }] },
    progress: { slots: { base: 'rounded-full', indicator: 'rounded-full' } },
    avatar: { slots: { root: 'ring-2 ring-bg' } },
    tabs: { slots: { list: 'rounded-md', indicator: 'rounded-sm', trigger: 'rounded-sm' } },

    // Floating layers carry the only shadows.
    dropdownMenu: { slots: { content: 'z-[var(--nasq-ui-z-menu)] rounded-lg shadow-lg ring ring-default' } },
    popover: { slots: { content: 'z-[var(--nasq-ui-z-menu)] rounded-lg shadow-lg ring ring-default' } },
    tooltip: { slots: { content: 'z-[var(--nasq-ui-z-menu)] rounded-md' } },
    slideover: { slots: { content: 'z-[var(--nasq-ui-z-sheet)]' } },
    modal: { slots: { content: 'z-[80] rounded-lg shadow-xl', overlay: 'z-[79] backdrop-blur-xs' } },
  },
})
