export default defineAppConfig({
  ui: {
    // The busy icon of buttons and other controls is the Sadu triangles and diamond of the LiwanOS mark, turning.
    icons: { loading: 'i-sadu-loader' },
    // Tasmim recipes (DESIGN.md «وصفات الثيم المعتمدة»). Colours: the fixed
    // LiwanOS ink primary (the company colour is for documents only), stone neutral, LiwanOS ink/charcoal in
    // tokens.css. Sizes come from tokens: --liwan-control-h (42px; a small control is 34px), --liwan-row-h, --liwan-card-pad and the one radius
    // system, four steps: rounded-tile (28% of the side: app tiles), rounded-card and rounded-surface (18px: cards, table
    // containers, banners, panels, modals), rounded-control (12px: every button, input, select, chip and menu), rounded-inner
    // (8px: segments, tags, badges, tooltips). Progress bars stay rounded-full. --ui-radius (8px) drives the stock scale.
    colors: { primary: 'brand', neutral: 'stone' },

    // tailwind-merge only knows the stock radius scale, so without this a recipe default such as rounded-md survives next
    // to our rounded-control / rounded-card and wins the cascade. Registering the names as radius theme values puts them
    // in the same conflict group as every rounded-* utility (the later class wins).
    tv: { twMergeConfig: { extend: { theme: { radius: ['tile', 'inner', 'control', 'card', 'surface'] } } } },

    // The 42px control floor applies to the default (md) size, 34px to sm; xs stays compact. Buttons are 600 weight and lift 1px on hover.
    // The solid primary paints from --primary-solid (ink with a white label in light mode, #f3f3f6 with a dark label in dark mode;
    // a paid application repaints it in its button shade, app-identity.css). --primary is for fills, icons and rings without text.
    button: {
      slots: { base: 'rounded-control font-semibold transition-[color,background-color,translate,scale,box-shadow,filter] [&:not([disabled],[aria-disabled=true])]:hover:-translate-y-px active:scale-[.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100' },
      variants: { size: { xs: { base: 'rounded-inner' }, sm: { base: 'min-h-[34px] px-3.5 text-(length:--liwan-fs-small-label) rounded-control' }, md: { base: 'min-h-(--liwan-control-h) px-5 gap-2' } } },
      compoundVariants: [
        { size: 'sm', square: true, class: 'min-w-[34px] justify-center' },
        { size: 'md', square: true, class: 'min-w-(--liwan-control-h) justify-center' },
        { color: 'primary', variant: 'solid', class: 'bg-(--primary-solid) text-(--primary-solid-foreground) shadow-[0_6px_14px_-6px_color-mix(in_srgb,var(--primary-solid)_45%,transparent)] hover:bg-(--primary-solid-hover) hover:text-(--primary-solid-hover-foreground) hover:shadow-[0_10px_20px_-8px_color-mix(in_srgb,var(--primary-solid)_50%,transparent)] active:bg-(--primary-solid-active) active:text-(--primary-solid-active-foreground) disabled:bg-(--primary-solid) aria-disabled:bg-(--primary-solid) dark:hover:brightness-110' },
      ],
    },
    input: { slots: { base: 'rounded-control bg-default' }, variants: { variant: { outline: 'ring-[1.5px] ring-(--ui-border)' }, size: { sm: { base: 'rounded-control' }, md: { base: 'min-h-(--liwan-control-h)' } } } },
    inputNumber: { slots: { base: 'rounded-control bg-default' }, variants: { variant: { outline: 'ring-[1.5px] ring-(--ui-border)' }, size: { sm: { base: 'rounded-control' }, md: { base: 'min-h-(--liwan-control-h)' } } } },
    textarea: { slots: { base: 'rounded-control bg-default' }, variants: { variant: { outline: 'ring-[1.5px] ring-(--ui-border)' } } },
    select: { slots: { base: 'rounded-control bg-default', content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' }, variants: { variant: { outline: 'ring-[1.5px] ring-(--ui-border)' }, size: { sm: { base: 'rounded-control' }, md: { base: 'min-h-(--liwan-control-h)' } } } },
    selectMenu: { slots: { base: 'rounded-control bg-default', content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' }, variants: { variant: { outline: 'ring-[1.5px] ring-(--ui-border)' }, size: { sm: { base: 'rounded-control' }, md: { base: 'min-h-(--liwan-control-h)' } } } },

    // Surfaces: a 1.5px hairline border (a 4% top highlight in dark mode), no resting shadow, 20px padding (--liwan-card-pad).
    card: { slots: { root: 'rounded-card bg-default ring-0 border-[1.5px] border-default shadow-none dark:shadow-(--liwan-card-highlight)', header: 'px-(--liwan-card-pad) py-3 sm:px-(--liwan-card-pad)', body: 'p-(--liwan-card-pad) sm:p-(--liwan-card-pad)', footer: 'px-(--liwan-card-pad) py-3 sm:px-(--liwan-card-pad)' }, variants: { variant: { outline: { root: 'ring-0' }, subtle: { root: 'ring-0 border-[1.5px] border-default' } } } },
    // Tables (SharedDataTable, DESIGN.md §6): a calm header (12px muted on a very soft fill, a 1px hairline under it), rows on
    // --liwan-row-h (48px dense, 52px comfortable) with tabular numerals and a hover tint. The layout (scrolling inside the card,
    // sticky edge columns, stacked row cards) is components.css, "Data tables".
    table: {
      slots: {
        th: 'h-[40px] bg-(--liwan-table-head-soft) px-(--liwan-card-pad) py-0 text-xs font-medium whitespace-nowrap text-muted',
        td: 'h-(--liwan-row-h) px-(--liwan-card-pad) py-0 text-sm tabular-nums',
        tr: 'transition-colors motion-reduce:transition-none hover:bg-(--liwan-row-hover) data-[selected=true]:bg-primary/5',
        separator: 'bg-(--ui-border)',
      },
    },

    // Status badges are subtle (soft fill) by default; outline is for buttons. The smallest badge text is 12px (xs/sm).
    // The 500 step on its 10% tint fails 4.5:1 (success 2.0, warning 1.8, error 3.3), so subtle/soft text of the four
    // status colours is the separate --status-*-foreground token (dark in light mode, light in dark mode; the ring and
    // fill keep the indicator colour). secondary uses the 800 step; primary/neutral are brand/stone and already pass.
    // Solid badges: white on error-500 is 3.8:1, so solid fills use the 600/700 step with white (warning: dark text on 500).
    badge: { slots: { base: 'rounded-inner' }, variants: { size: { xs: { base: 'text-xs/4 px-1.5 py-0.5 rounded-inner' }, sm: { base: 'text-xs/4 px-1.5 py-0.5 rounded-inner' } } }, defaultVariants: { variant: 'subtle' }, compoundVariants: [{ color: 'secondary', variant: 'soft', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'soft', class: 'text-status-success-foreground' }, { color: 'info', variant: 'soft', class: 'text-status-info-foreground' }, { color: 'warning', variant: 'soft', class: 'text-status-warning-foreground' }, { color: 'error', variant: 'soft', class: 'text-status-danger-foreground' }, { color: 'secondary', variant: 'subtle', class: 'text-secondary-800 dark:text-secondary' }, { color: 'success', variant: 'subtle', class: 'text-status-success-foreground' }, { color: 'info', variant: 'subtle', class: 'text-status-info-foreground' }, { color: 'warning', variant: 'subtle', class: 'text-status-warning-foreground' }, { color: 'error', variant: 'subtle', class: 'text-status-danger-foreground' }, { color: 'secondary', variant: 'solid', class: 'bg-secondary-600 text-white dark:bg-secondary dark:text-inverted' }, { color: 'success', variant: 'solid', class: 'bg-success-700 text-white dark:bg-success dark:text-inverted' }, { color: 'info', variant: 'solid', class: 'bg-info-600 text-white dark:bg-info dark:text-inverted' }, { color: 'warning', variant: 'solid', class: 'bg-warning-500 text-slate-900 dark:bg-warning dark:text-inverted' }, { color: 'error', variant: 'solid', class: 'bg-error-600 text-white dark:bg-error dark:text-inverted' }] },
    // The brand fills the bar in both modes (--ui-primary is the readable brand tone); a finished bar keeps the primary (SharedProgress keeps the tone colour on the success, warning and danger tones).
    // Bar heights are the --liwan-progress-* tokens (sm 6px, md 8px); the fill animates over 300ms, off under reduced motion.
    progress: { slots: { base: 'bg-(color:--ui-border-muted)', indicator: 'duration-(--liwan-motion-panel) motion-reduce:transition-none' }, compoundVariants: [{ orientation: 'horizontal', size: 'sm', class: { base: 'h-(--liwan-progress-sm) rounded-[2px]', indicator: 'rounded-[2px]' } }, { orientation: 'horizontal', size: 'md', class: { base: 'h-(--liwan-progress-md) rounded-[3px]', indicator: 'rounded-[3px]' } }] },
    avatar: { slots: { root: 'ring-2 ring-bg' } },
    tabs: { slots: { list: 'rounded-control', indicator: 'rounded-inner', trigger: 'rounded-inner', content: 'rounded-control' } },

    // Floating layers carry the only shadows.
    dropdownMenu: { slots: { content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' } },
    popover: { slots: { content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' } },
    tooltip: { slots: { content: 'z-[var(--liwan-ui-z-menu)] rounded-inner' } },
    contextMenu: { slots: { content: 'z-[var(--liwan-ui-z-menu)] rounded-control shadow-lg ring ring-default' } },
    modal: { slots: { content: 'z-[80] shadow-xl', overlay: 'z-[79] backdrop-blur-xs' }, variants: { fullscreen: { false: { content: 'rounded-surface' } } } },
    // Inset drawers and panels float over the canvas, so they take the large-surface radius.
    slideover: { slots: { content: 'z-[var(--liwan-ui-z-sheet)]' }, variants: { inset: { true: { content: 'rounded-surface' } } } },
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
