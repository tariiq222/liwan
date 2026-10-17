export default defineAppConfig({
  ui: {
    // Tasmim recipes (DESIGN.md «وصفات الثيم المعتمدة»). Colours: tenant primary
    // from settings (utils/brandTheme.ts), slate neutral, WebVue midnight/lime in
    // tokens.css. Sizes come from tokens: --webvue-control-h, --webvue-row-h,
    // --ui-radius (rounded-md = 9px, rounded-lg = 12px, rounded-xl = 18px at the 14px root).
    colors: { primary: 'brand', neutral: 'slate' },

    // The 32px control floor applies to the default (md) size only; xs/sm stay compact.
    // Dark mode: the solid primary paints from --primary-solid (brandTheme.ts darkSolid), not the
    // greyed --brand-link that text-primary and focus keep (owner amendment 4, CP2).
    button: { slots: { base: 'rounded-full transition-colors duration-150 motion-reduce:transition-none' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } }, compoundVariants: [{ size: 'md', square: true, class: 'min-w-(--webvue-control-h)' }, { color: 'primary', variant: 'solid', class: 'dark:bg-(--primary-solid) dark:text-(--primary-solid-foreground) dark:hover:bg-(--primary-solid-hover) dark:hover:text-(--primary-solid-hover-foreground) dark:active:bg-(--primary-solid-hover) dark:active:text-(--primary-solid-hover-foreground) dark:disabled:bg-(--primary-solid) dark:aria-disabled:bg-(--primary-solid)' }] },
    input: { slots: { base: 'rounded-lg bg-default' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } } },
    inputNumber: { slots: { base: 'rounded-lg bg-default' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } } },
    textarea: { slots: { base: 'rounded-lg bg-default' } },
    select: { slots: { base: 'rounded-lg bg-default', content: 'z-[var(--webvue-ui-z-menu)] rounded-xl shadow-lg ring ring-default' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } } },
    selectMenu: { slots: { base: 'rounded-lg bg-default', content: 'z-[var(--webvue-ui-z-menu)] rounded-xl shadow-lg ring ring-default' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } } },

    // Surfaces: hairline ring, no resting shadow, compact padding.
    card: { slots: { root: 'rounded-xl bg-default ring ring-default shadow-none', header: 'px-4 py-3 sm:px-4', body: 'p-3 sm:p-4', footer: 'px-4 py-3 sm:px-4' } },
    table: {
      slots: {
        th: 'h-(--webvue-row-h) bg-elevated/60 px-3 py-0 text-xs font-medium text-muted',
        td: 'h-(--webvue-row-h) px-3 py-0 text-sm',
        tr: 'transition-colors hover:bg-elevated/50 data-[selected=true]:bg-primary/5',
      },
    },

    // Status badges are subtle (soft fill) by default; outline is for buttons. The smallest badge text is 12px (xs/sm).
    // Light mode: the 500 step on its 10% tint fails 4.5:1 (success 2.0, warning 1.8, error 3.3), so subtle/soft
    // text uses the 800 step; dark mode keeps the stock 400 step. primary/neutral are brand/slate and already pass.
    // Solid badges: white on error-500 is 3.8:1, so solid fills use the 600/700 step with white (warning: dark text on 500).
    badge: { slots: { base: 'rounded-full' }, variants: { size: { xs: { base: 'text-xs/4 px-1.5 py-0.5 rounded-full' }, sm: { base: 'text-xs/4 px-1.5 py-0.5 rounded-full' } } }, defaultVariants: { variant: 'subtle' }, compoundVariants: [{ color: 'secondary', variant: 'soft', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'soft', class: 'text-success-800 dark:text-success' }, { color: 'info', variant: 'soft', class: 'text-info-800 dark:text-info' }, { color: 'warning', variant: 'soft', class: 'text-warning-800 dark:text-warning' }, { color: 'error', variant: 'soft', class: 'text-error-800 dark:text-error' }, { color: 'secondary', variant: 'subtle', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'subtle', class: 'text-success-800 dark:text-success' }, { color: 'info', variant: 'subtle', class: 'text-info-800 dark:text-info' }, { color: 'warning', variant: 'subtle', class: 'text-warning-800 dark:text-warning' }, { color: 'error', variant: 'subtle', class: 'text-error-800 dark:text-error' }, { color: 'secondary', variant: 'solid', class: 'bg-secondary-600 text-white dark:bg-secondary dark:text-inverted' }, { color: 'success', variant: 'solid', class: 'bg-success-700 text-white dark:bg-success dark:text-inverted' }, { color: 'info', variant: 'solid', class: 'bg-info-600 text-white dark:bg-info dark:text-inverted' }, { color: 'warning', variant: 'solid', class: 'bg-warning-500 text-slate-900 dark:bg-warning dark:text-inverted' }, { color: 'error', variant: 'solid', class: 'bg-error-600 text-white dark:bg-error dark:text-inverted' }] },
    // The brand fills the bar in both modes (--ui-primary is the readable brand tone); a finished bar turns lime.
    progress: { slots: { base: 'rounded-full', indicator: 'rounded-full data-[state=complete]:bg-webvue-lime' } },
    avatar: { slots: { root: 'ring-2 ring-bg' } },
    tabs: { slots: { list: 'rounded-full', indicator: 'rounded-full', trigger: 'rounded-full' } },

    // Floating layers carry the only shadows.
    dropdownMenu: { slots: { content: 'z-[var(--webvue-ui-z-menu)] rounded-xl shadow-lg ring ring-default' } },
    popover: { slots: { content: 'z-[var(--webvue-ui-z-menu)] rounded-xl shadow-lg ring ring-default' } },
    tooltip: { slots: { content: 'z-[var(--webvue-ui-z-menu)] rounded-md' } },
    slideover: { slots: { content: 'z-[var(--webvue-ui-z-sheet)]' } },
    modal: { slots: { content: 'z-[80] rounded-2xl shadow-xl', overlay: 'z-[79] backdrop-blur-xs' } },
  },
})
