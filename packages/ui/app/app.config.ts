export default defineAppConfig({
  ui: {
    // Tasmim recipes (DESIGN.md «وصفات الثيم المعتمدة»). Colours: the fixed
    // LiwanOS primary (the company colour is for documents only), stone (warm) neutral, LiwanOS lavender/sand/ink in
    // tokens.css. Sizes come from tokens: --liwan-control-h, --liwan-row-h, --liwan-card-pad and the
    // radii rounded-card (18px: cards, panels, table containers) and rounded-control (12px: inputs, selects,
    // textareas, small inner blocks); buttons, badges, tabs and progress stay rounded-full. --ui-radius drives the rest of the scale.
    colors: { primary: 'brand', neutral: 'stone' },

    // tailwind-merge only knows the stock radius scale, so without this a recipe default such as rounded-md survives next
    // to our rounded-control / rounded-card and wins the cascade. Registering both names as radius theme values puts them
    // in the same conflict group as every rounded-* utility (the later class wins).
    tv: { twMergeConfig: { extend: { theme: { radius: ['card', 'control'] } } } },

    // The 32px control floor applies to the default (md) size only; xs/sm stay compact.
    // The solid primary paints from --primary-solid (#5b3f8c light, #7c5cc4 dark, white label >= 4.5:1); the accent
    // --primary (#c9bbee in dark mode) is for fills, icons and rings without text. text-primary and focus keep --brand-link.
    button: { slots: { base: 'rounded-full transition-colors duration-150 motion-reduce:transition-none' }, variants: { size: { md: { base: 'min-h-(--liwan-control-h)' } } }, compoundVariants: [{ size: 'md', square: true, class: 'min-w-(--liwan-control-h)' }, { color: 'primary', variant: 'solid', class: 'bg-(--primary-solid) text-(--primary-solid-foreground) hover:bg-(--primary-solid-hover) hover:text-(--primary-solid-hover-foreground) active:bg-(--primary-solid-active) active:text-(--primary-solid-active-foreground) disabled:bg-(--primary-solid) aria-disabled:bg-(--primary-solid)' }] },
    input: { slots: { base: 'rounded-control bg-default' }, variants: { size: { md: { base: 'min-h-(--liwan-control-h)' } } } },
    inputNumber: { slots: { base: 'rounded-control bg-default' }, variants: { size: { md: { base: 'min-h-(--liwan-control-h)' } } } },
    textarea: { slots: { base: 'rounded-control bg-default' } },
    select: { slots: { base: 'rounded-control bg-default', content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' }, variants: { size: { md: { base: 'min-h-(--liwan-control-h)' } } } },
    selectMenu: { slots: { base: 'rounded-control bg-default', content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' }, variants: { size: { md: { base: 'min-h-(--liwan-control-h)' } } } },

    // Surfaces: hairline ring, no resting shadow, 20px padding (--liwan-card-pad).
    card: { slots: { root: 'rounded-card bg-default ring ring-default shadow-none', header: 'px-(--liwan-card-pad) py-3 sm:px-(--liwan-card-pad)', body: 'p-(--liwan-card-pad) sm:p-(--liwan-card-pad)', footer: 'px-(--liwan-card-pad) py-3 sm:px-(--liwan-card-pad)' } },
    table: {
      slots: {
        th: 'h-[40px] bg-(--liwan-table-head) px-(--liwan-card-pad) py-0 text-xs font-medium text-muted',
        td: 'h-(--liwan-row-h) px-(--liwan-card-pad) py-0 text-sm',
        tr: 'transition-colors duration-150 motion-reduce:transition-none hover:bg-(--liwan-row-hover) data-[selected=true]:bg-primary/5',
      },
    },

    // Status badges are subtle (soft fill) by default; outline is for buttons. The smallest badge text is 12px (xs/sm).
    // The 500 step on its 10% tint fails 4.5:1 (success 2.0, warning 1.8, error 3.3), so subtle/soft text of the four
    // status colours is the separate --status-*-foreground token (dark in light mode, light in dark mode; the ring and
    // fill keep the indicator colour). secondary uses the 800 step; primary/neutral are brand/stone and already pass.
    // Solid badges: white on error-500 is 3.8:1, so solid fills use the 600/700 step with white (warning: dark text on 500).
    badge: { slots: { base: 'rounded-full' }, variants: { size: { xs: { base: 'text-xs/4 px-1.5 py-0.5 rounded-full' }, sm: { base: 'text-xs/4 px-1.5 py-0.5 rounded-full' } } }, defaultVariants: { variant: 'subtle' }, compoundVariants: [{ color: 'secondary', variant: 'soft', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'soft', class: 'text-status-success-foreground' }, { color: 'info', variant: 'soft', class: 'text-status-info-foreground' }, { color: 'warning', variant: 'soft', class: 'text-status-warning-foreground' }, { color: 'error', variant: 'soft', class: 'text-status-danger-foreground' }, { color: 'secondary', variant: 'subtle', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'subtle', class: 'text-status-success-foreground' }, { color: 'info', variant: 'subtle', class: 'text-status-info-foreground' }, { color: 'warning', variant: 'subtle', class: 'text-status-warning-foreground' }, { color: 'error', variant: 'subtle', class: 'text-status-danger-foreground' }, { color: 'secondary', variant: 'solid', class: 'bg-secondary-600 text-white dark:bg-secondary dark:text-inverted' }, { color: 'success', variant: 'solid', class: 'bg-success-700 text-white dark:bg-success dark:text-inverted' }, { color: 'info', variant: 'solid', class: 'bg-info-600 text-white dark:bg-info dark:text-inverted' }, { color: 'warning', variant: 'solid', class: 'bg-warning-500 text-slate-900 dark:bg-warning dark:text-inverted' }, { color: 'error', variant: 'solid', class: 'bg-error-600 text-white dark:bg-error dark:text-inverted' }] },
    // The brand fills the bar in both modes (--ui-primary is the readable brand tone); a finished bar keeps the primary (SharedProgress keeps the tone colour on the success, warning and danger tones).
    // Bar heights are the --liwan-progress-* tokens (sm 6px, md 8px); the fill animates over 300ms, off under reduced motion.
    progress: { slots: { base: 'rounded-full bg-(color:--ui-border-muted)', indicator: 'rounded-full duration-300 motion-reduce:transition-none' }, compoundVariants: [{ orientation: 'horizontal', size: 'sm', class: 'h-(--liwan-progress-sm)' }, { orientation: 'horizontal', size: 'md', class: 'h-(--liwan-progress-md)' }] },
    avatar: { slots: { root: 'ring-2 ring-bg' } },
    tabs: { slots: { list: 'rounded-full', indicator: 'rounded-full', trigger: 'rounded-full', content: 'rounded-control' } },

    // Floating layers carry the only shadows.
    dropdownMenu: { slots: { content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' } },
    popover: { slots: { content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' } },
    tooltip: { slots: { content: 'z-[var(--liwan-ui-z-menu)] rounded-control' } },
    contextMenu: { slots: { content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' } },
    modal: { slots: { content: 'z-[80] shadow-xl', overlay: 'z-[79] backdrop-blur-xs' }, variants: { fullscreen: { false: { content: 'rounded-card' } } } },
    // Inset drawers and panels float over the canvas, so they take the card radius too.
    slideover: { slots: { content: 'z-[var(--liwan-ui-z-sheet)]' }, variants: { inset: { true: { content: 'rounded-card' } } } },
    toast: { slots: { root: 'rounded-card' } },
    // Alerts are subtle (soft tint) by default: the stock solid fill puts white text on saturated amber/red (about 2:1 for warning).
    // Status text uses the same --status-*-foreground tokens as badges.
    alert: { slots: { root: 'rounded-card' }, defaultVariants: { variant: 'subtle' }, compoundVariants: [{ color: 'success', variant: 'subtle', class: { root: 'text-status-success-foreground' } }, { color: 'info', variant: 'subtle', class: { root: 'text-status-info-foreground' } }, { color: 'warning', variant: 'subtle', class: { root: 'text-status-warning-foreground' } }, { color: 'error', variant: 'subtle', class: { root: 'text-status-danger-foreground' } }] },
    pageCard: { slots: { root: 'rounded-card' } },
    listbox: { slots: { root: 'rounded-control' } },
    fileUpload: { slots: { base: 'rounded-card' } },
    inputMenu: { slots: { base: 'rounded-control', content: 'z-[var(--liwan-ui-z-menu)] rounded-control' } },
    inputTags: { slots: { base: 'rounded-control' } },
    inputDate: { slots: { base: 'rounded-control' } },
    inputTime: { slots: { base: 'rounded-control' } },
  },
})
