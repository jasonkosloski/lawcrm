// app-blue.jsx — "blue pops" polish layer.
// Pushes color into a mostly-neutral UI: richer accent blue, tinted sidebar,
// colored KPIs, blue-brand topbar line, blue active nav, accented CTAs.
// Loaded last so it overrides baseline tokens.

(() => {
  if (document.getElementById('app-blue-styles')) return;
  const s = document.createElement('style');
  s.id = 'app-blue-styles';
  s.textContent = `
    /* ── richer blue palette ─────────────────────────────────────────── */
    :root {
      --blue-50:  #f0f6fc;
      --blue-100: #dbeafe;
      --blue-200: #b3d4ec;
      --blue-300: #7fb4d9;
      --blue-400: #4a8fc2;
      --blue-500: #2563a8;   /* primary brand blue */
      --blue-600: #1e4f88;
      --blue-700: #18406e;
      --blue-900: #0c2443;
      --blue-soft: #eaf3fa;
      --blue-tint: #f6faff;
    }

    /* Re-point the global accent used throughout to the new blue */
    .mf { --mf-accent: var(--blue-500) !important; }

    /* body bg — keep warm paper but slightly cooler */
    #app { background: #f7f5ef; }

    /* ── sidebar: tint + blue brand + blue active ─────────────────── */
    .mf > .mf-col:first-child {
      background: linear-gradient(180deg, #f6f5ef 0%, #eef2f5 100%) !important;
      border-right-color: #dbd7cc !important;
    }
    /* logo tile */
    .mf > .mf-col:first-child > .mf-between > .mf-row > div:first-child {
      background: var(--blue-500) !important;
      box-shadow: 0 2px 6px -2px rgba(37,99,168,.6), inset 0 1px 0 rgba(255,255,255,.2);
    }
    /* active nav = blue instead of near-black */
    .mf-nav.on {
      background: var(--blue-500) !important;
      color: #fff !important;
      box-shadow: 0 1px 0 rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.12);
    }
    .mf-nav.on .mf-dot { box-shadow: 0 0 0 2px rgba(255,255,255,.35); }
    .mf-nav:hover:not(.on) { background: #eaf0f5; color: var(--blue-700); }
    .mf-nav-badge {
      background: var(--blue-50);
      color: var(--blue-700);
      border: 1px solid var(--blue-100);
    }
    .mf-nav.on .mf-nav-badge {
      background: rgba(255,255,255,.18) !important;
      color: #fff !important;
      border-color: transparent !important;
    }
    .mf-nav.on .mf-nav-ic { color: #fff !important; }

    /* status bar at bottom of sidebar */
    .app-statusbar { background: #e8ece9 !important; border-top-color: #d8d3c7 !important; color: #4a5561 !important; }
    .app-statusbar .dot { background: var(--blue-500) !important; box-shadow: 0 0 0 3px rgba(37,99,168,.18); }

    /* ── top bar: thin blue brand line + warmer title ────────────── */
    .mf-col > .mf-col > div[style*="border-bottom"][style*="background"] {
      /* top bar container — add blue hairline by layering box-shadow */
    }
    .app-brand-bar { height: 3px; background: linear-gradient(90deg, var(--blue-500), var(--blue-300) 40%, #e5e4de 80%); }

    /* ── buttons ──────────────────────────────────────────────────── */
    /* Make "primary" the brand blue, not black */
    .mf-btn-primary {
      background: var(--blue-500) !important;
      border-color: var(--blue-500) !important;
      color: #fff !important;
      box-shadow: 0 1px 0 rgba(0,0,0,.06), 0 4px 10px -4px rgba(37,99,168,.45) !important;
    }
    .mf-btn-primary:hover {
      background: var(--blue-600) !important;
      border-color: var(--blue-600) !important;
    }
    /* non-primary button gets a subtle blue hover */
    .mf-btn:hover:not(.mf-btn-primary):not(.mf-btn-accent):not(.mf-btn-ghost) {
      border-color: var(--blue-300) !important;
      color: var(--blue-700) !important;
    }

    /* ── chips ────────────────────────────────────────────────────── */
    .mf-chip-accent {
      border-color: var(--blue-200) !important;
      color: var(--blue-700) !important;
      background: var(--blue-soft) !important;
      font-weight: 600;
    }
    .mf-chip-fill {
      background: var(--blue-500) !important;
      border-color: var(--blue-500) !important;
    }

    /* ── cards: card hover lift gets a blue tint ─────────────────── */
    .app-card-hover:hover {
      border-color: var(--blue-300) !important;
      box-shadow: 0 2px 0 rgba(0,0,0,.02), 0 10px 24px -14px rgba(37,99,168,.35) !important;
    }

    /* ── focus ring → blue ───────────────────────────────────────── */
    .mf *:focus-visible { outline-color: var(--blue-500) !important; }

    /* ── palette (⌘K) ───────────────────────────────────────────── */
    .app-palette-row.on { background: var(--blue-soft) !important; color: var(--blue-900) !important; }

    /* ── calendar now chip & time marker ─────────────────────────── */
    /* leave .mf-warn as-is for true warnings; but tint body warning refs */

    /* ── spark: give bars a gradient feel by default ─────────────── */
    .app-spark rect { fill: var(--blue-500); }

    /* ── tables: header light blue, hover row tinted ─────────────── */
    .mf-table th {
      background: #edf1f3 !important;
      color: var(--blue-700) !important;
      border-top-color: #dbe2e6 !important;
      border-bottom-color: #dbe2e6 !important;
      letter-spacing: .05em;
    }
    .mf-table tr:hover td { background: var(--blue-tint) !important; }

    /* selected/active rows (intake list etc) — accentSoft already updated */

    /* Seg active */
    .mf-seg > div.on {
      background: var(--blue-500) !important;
      box-shadow: 0 1px 0 rgba(0,0,0,.06);
    }
    .mf-seg { border-color: #d6dce2; }

    /* Tabs (matter subtabs) — active indicator blue */
    /* We inline these in app-matter, so add a utility class for the underline */
    .app-tab-active-blue { border-bottom-color: var(--blue-500) !important; color: var(--blue-900) !important; }

    /* ── KPI tile color backgrounds for home screen ───────────────
       Scopes to .app-kpi children only so we don't recolor every card. */
    .app-kpi { position: relative; overflow: hidden; }
    .app-kpi::before {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(135deg, var(--blue-tint) 0%, #fff 55%);
      pointer-events: none; z-index: 0;
    }
    .app-kpi > * { position: relative; z-index: 1; }
    .app-kpi.k-critical::before { background: linear-gradient(135deg, #fbf0ea 0%, #fff 55%); }
    .app-kpi.k-ok::before       { background: linear-gradient(135deg, #ecf6f1 0%, #fff 55%); }
    .app-kpi.k-accent::before   { background: linear-gradient(135deg, var(--blue-soft) 0%, #fff 55%); }
    .app-kpi .app-kpi-ic {
      position: absolute; top: 10px; right: 10px; width: 28px; height: 28px; border-radius: 8px;
      background: var(--blue-500); color: #fff; display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 10px -4px rgba(37,99,168,.6);
    }
    .app-kpi.k-critical .app-kpi-ic { background: #b6623d; box-shadow: 0 4px 10px -4px rgba(182,98,61,.55); }
    .app-kpi.k-ok       .app-kpi-ic { background: #2d8a5f; box-shadow: 0 4px 10px -4px rgba(45,138,95,.5); }

    /* H1 / display — slightly deeper color */
    .app-h1 { color: #0f1b2e !important; }

    /* Sidebar bottom avatar: blue ring */
    .mf > .mf-col:first-child .mf-av-lg {
      box-shadow: 0 0 0 2px var(--blue-100);
    }

    /* Command hint keycaps */
    .mf-kbd {
      background: #fff !important;
      border-color: #d6dce2 !important;
      color: var(--blue-700) !important;
    }
    .mf-nav.on .mf-kbd { color: #fff !important; background: rgba(255,255,255,.15) !important; border-color: rgba(255,255,255,.25) !important; }

    /* Settlement chip blue for "ready" */
    /* Already uses chip-accent → now blue */

    /* Global-search chip: slight blue tint */
    .mf-input {
      background: #fff !important;
      border-color: #d6dce2 !important;
    }
    .mf-input:hover { border-color: var(--blue-300) !important; }

    /* Scrollbar */
    ::-webkit-scrollbar-thumb { background-color: #c9ced4 !important; }

    /* Decorative: blue border on focused cards used for signatures */
    .app-card-blue { border-top: 3px solid var(--blue-500) !important; }

    /* Toast matches brand */
    .app-toast { background: var(--blue-900) !important; box-shadow: 0 14px 30px -10px rgba(12,36,67,.45) !important; }

    /* ── logo tile recolor via attribute selector on the "k" glyph ── */
    /* The Kosloski monogram tile is the only square with exactly "k" in it and inline black bg.
       We override via a strong class added by JS below. */
    .app-logo-blue {
      background: linear-gradient(135deg, var(--blue-500), var(--blue-700)) !important;
      color: #fff !important;
      box-shadow: 0 2px 6px -2px rgba(37,99,168,.55), inset 0 1px 0 rgba(255,255,255,.18) !important;
    }

    /* Matter tab underline when active (app-matter uses inline styles) */
    .app-mtab[data-on="true"] { color: var(--blue-900) !important; border-bottom-color: var(--blue-500) !important; }

    /* Top bar blue hairline */
    .app-topbar-blue-line {
      height: 2px; background: linear-gradient(90deg, var(--blue-500) 0%, var(--blue-300) 35%, transparent 75%);
    }
  `;
  document.head.appendChild(s);

  // ── one-time DOM upgrades ──────────────────────────────────────
  // 1) Paint the Kosloski "k" logo tile blue. Find it by text content.
  // 2) Tag the 4 KPI cards with color classes (first = neutral blue, second = critical, third = blue, fourth = ok).
  // 3) Add a thin blue brand strip at the top of the main content area.
  const applyUpgrades = () => {
    // logo tile: first .mf-disp sibling of a 24x24 tile showing "k"
    document.querySelectorAll('.mf .mf-row > div').forEach(el => {
      if (el.textContent.trim() === 'k' && el.offsetWidth > 0 && el.offsetWidth <= 30 && !el.classList.contains('app-logo-blue')) {
        el.classList.add('app-logo-blue');
      }
    });

    // KPI grid: first grid child under main that has 4 columns of mf-card
    document.querySelectorAll('.mf-card.app-card-hover').forEach((el) => {
      const grid = el.parentElement;
      if (!grid || grid.dataset.kpiTagged) return;
      const style = getComputedStyle(grid);
      if (style.display !== 'grid') return;
      if (!(style.gridTemplateColumns || '').split(' ').length === 4) return;
      const cards = Array.from(grid.querySelectorAll(':scope > .mf-card'));
      if (cards.length !== 4) return;
      grid.dataset.kpiTagged = '1';
      const kinds = ['k-accent', 'k-critical', 'k-accent', 'k-ok'];
      const icons = ['briefcase', 'clock', 'hash', 'dollar'];
      cards.forEach((c, i) => {
        c.classList.add('app-kpi', kinds[i]);
        if (!c.querySelector('.app-kpi-ic')) {
          const ic = document.createElement('div');
          ic.className = 'app-kpi-ic';
          ic.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${i === 0 ? '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>' : ''}
            ${i === 1 ? '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>' : ''}
            ${i === 2 ? '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>' : ''}
            ${i === 3 ? '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' : ''}
          </svg>`;
          c.prepend(ic);
        }
      });
    });

    // Add blue strip under topbar once per page shell (top child with border-bottom)
    document.querySelectorAll('.mf > .mf-col.mf-flex1').forEach((main) => {
      if (main.dataset.brandStripped) return;
      const firstChild = main.firstElementChild;
      if (!firstChild) return;
      main.dataset.brandStripped = '1';
      const strip = document.createElement('div');
      strip.className = 'app-topbar-blue-line';
      firstChild.insertAdjacentElement('afterend', strip);
    });
  };

  // Run after React paints + on every mutation (screen changes)
  const schedule = () => requestAnimationFrame(() => setTimeout(applyUpgrades, 30));
  const mo = new MutationObserver(schedule);
  const boot = () => {
    const app = document.getElementById('app');
    if (app) mo.observe(app, { childList: true, subtree: true });
    schedule();
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
