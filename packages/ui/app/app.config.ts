export default defineAppConfig({
  ui: {
    // Tasmim recipes (DESIGN.md «وصفات الثيم المعتمدة»). Colours: the fixed
    // WebVue primary (the company colour is for documents only), slate neutral, WebVue midnight/lime in
    // tokens.css. Sizes come from tokens: --webvue-control-h, --webvue-row-h, --webvue-card-pad and the
    // radii rounded-card (18px: cards, panels, table containers) and rounded-control (12px: inputs, selects,
    // textareas, small inner blocks); buttons, badges, tabs and progress stay rounded-full. --ui-radius drives the rest of the scale.
    colors: { primary: 'brand', neutral: 'slate' },

    // The 32px control floor applies to the default (md) size only; xs/sm stay compact.
    // The solid primary paints from --primary-solid (#0066cc, white label >= 4.5:1) in both modes; the accent
    // --primary (#007ff8) is for fills, icons and rings without text. text-primary and focus keep --brand-link.
    button: { slots: { base: 'rounded-full transition-colors duration-150 motion-reduce:transition-none' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } }, compoundVariants: [{ size: 'md', square: true, class: 'min-w-(--webvue-control-h)' }, { color: 'primary', variant: 'solid', class: 'bg-(--primary-solid) text-(--primary-solid-foreground) hover:bg-(--primary-solid-hover) hover:text-(--primary-solid-hover-foreground) active:bg-(--primary-solid-active) active:text-(--primary-solid-active-foreground) disabled:bg-(--primary-solid) aria-disabled:bg-(--primary-solid)' }] },
    input: { slots: { base: 'rounded-control bg-default' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } } },
    inputNumber: { slots: { base: 'rounded-control bg-default' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } } },
    textarea: { slots: { base: 'rounded-control bg-default' } },
    select: { slots: { base: 'rounded-control bg-default', content: 'z-[var(--webvue-ui-z-menu)] rounded-xl shadow-lg ring ring-default' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } } },
    selectMenu: { slots: { base: 'rounded-control bg-default', content: 'z-[var(--webvue-ui-z-menu)] rounded-xl shadow-lg ring ring-default' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } } },

    // Surfaces: hairline ring, no resting shadow, 20px padding (--webvue-card-pad).
    card: { slots: { root: 'rounded-card bg-default ring ring-default shadow-none', header: 'px-(--webvue-card-pad) py-3 sm:px-(--webvue-card-pad)', body: 'p-(--webvue-card-pad) sm:p-(--webvue-card-pad)', footer: 'px-(--webvue-card-pad) py-3 sm:px-(--webvue-card-pad)' } },
    table: {
      slots: {
        th: 'h-(--webvue-row-h) bg-muted px-(--webvue-card-pad) py-0 text-xs font-medium text-muted',
        td: 'h-(--webvue-row-h) px-(--webvue-card-pad) py-0 text-sm',
        tr: 'transition-colors duration-150 motion-reduce:transition-none hover:bg-(--webvue-row-hover) data-[selected=true]:bg-primary/5',
      },
    },

    // Status badges are subtle (soft fill) by default; outline is for buttons. The smallest badge text is 12px (xs/sm).
    // The 500 step on its 10% tint fails 4.5:1 (success 2.0, warning 1.8, error 3.3), so subtle/soft text of the four
    // status colours is the separate --status-*-foreground token (dark in light mode, light in dark mode; the ring and
    // fill keep the indicator colour). secondary uses the 800 step; primary/neutral are brand/slate and already pass.
    // Solid badges: white on error-500 is 3.8:1, so solid fills use the 600/700 step with white (warning: dark text on 500).
    badge: { slots: { base: 'rounded-full' }, variants: { size: { xs: { base: 'text-xs/4 px-1.5 py-0.5 rounded-full' }, sm: { base: 'text-xs/4 px-1.5 py-0.5 rounded-full' } } }, defaultVariants: { variant: 'subtle' }, compoundVariants: [{ color: 'secondary', variant: 'soft', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'soft', class: 'text-status-success-foreground' }, { color: 'info', variant: 'soft', class: 'text-status-info-foreground' }, { color: 'warning', variant: 'soft', class: 'text-status-warning-foreground' }, { color: 'error', variant: 'soft', class: 'text-status-danger-foreground' }, { color: 'secondary', variant: 'subtle', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'subtle', class: 'text-status-success-foreground' }, { color: 'info', variant: 'subtle', class: 'text-status-info-foreground' }, { color: 'warning', variant: 'subtle', class: 'text-status-warning-foreground' }, { color: 'error', variant: 'subtle', class: 'text-status-danger-foreground' }, { color: 'secondary', variant: 'solid', class: 'bg-secondary-600 text-white dark:bg-secondary dark:text-inverted' }, { color: 'success', variant: 'solid', class: 'bg-success-700 text-white dark:bg-success dark:text-inverted' }, { color: 'info', variant: 'solid', class: 'bg-info-600 text-white dark:bg-info dark:text-inverted' }, { color: 'warning', variant: 'solid', class: 'bg-warning-500 text-slate-900 dark:bg-warning dark:text-inverted' }, { color: 'error', variant: 'solid', class: 'bg-error-600 text-white dark:bg-error dark:text-inverted' }] },
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
