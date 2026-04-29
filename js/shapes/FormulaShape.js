import { Shape } from './Shape.js';

/**
 * LaTeX formula shape rendered via KaTeX inside a <foreignObject>.
 * For SVG export, rasterise() builds a self-contained SVG data-URI.
 */
export class FormulaShape extends Shape {
  /** Internal: cached CSS promise (null = not yet computed). */
  static _cssCache = null;
  static _cssCacheEmbedFonts = null; // which embedFonts value the cache was built with

  /** Call this to force a rebuild of the CSS cache. */
  static invalidateCSSCache() { FormulaShape._cssCache = null; }
  constructor(data = {}) {
    super({ type: 'formula', fill: 'transparent', stroke: 'transparent', strokeWidth: 0, ...data });
    this.latex     = data.latex     ?? '\\frac{1}{2}x^2';
    this.display   = data.display   ?? true;
    this.fontSize  = data.fontSize  ?? 18;
    this.textColor = data.textColor ?? '#e8e8f0';
    this.bgFill    = data.bgFill    ?? 'transparent';
  }

  createElements(g) {
    this._fo = this.makeSVGEl('foreignObject');
    this._wrap = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    this._wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    this._wrap.className = 'formula-shape-wrap';
    this._fo.appendChild(this._wrap);
    g.appendChild(this._fo);
  }

  render() {
    if (!this.el) return;
    const cx = this.cx, cy = this.cy;
    this.el.setAttribute('transform', `rotate(${this.rotation},${cx},${cy})`);
    this.el.style.opacity = this.opacity;

    this._fo.setAttribute('x',      this.x);
    this._fo.setAttribute('y',      this.y);
    this._fo.setAttribute('width',  Math.max(20, this.width));
    this._fo.setAttribute('height', Math.max(20, this.height));

    Object.assign(this._wrap.style, {
      color:          this.textColor,
      background:     this.bgFill,
      fontSize:       this.fontSize + 'px',
      display:        'flex',
      alignItems:     'center',
      justifyContent: this.display ? 'center' : 'flex-start',
      width:          '100%',
      height:         '100%',
      overflow:       'hidden',
      boxSizing:      'border-box',
      padding:        '4px',
    });

    try {
      this._wrap.innerHTML = window.katex.renderToString(this.latex, {
        displayMode:  this.display,
        throwOnError: false,
        errorColor:   '#f44',
      });
    } catch(e) {
      this._wrap.textContent = '⚠ ' + e.message;
    }
  }

  /**
   * Collect all CSS from the page, including cross-origin stylesheets.
   *
   * Same-origin sheets are read via cssRules; cross-origin sheets are
   * fetched as text (CDN stylesheets like KaTeX have CORS headers).
   *
   * Font url() references are either:
   *   - Embedded as data-URIs (embedFonts = true, default) — self-contained
   *   - Rewritten to absolute CDN URLs (embedFonts = false) — smaller files
   *
   * The result is cached at the class level so fonts are fetched only once
   * per page load, regardless of how many formulas are exported.
   */
  static async _collectCSS(embedFonts = true) {
    // Return cached result if embedFonts setting hasn't changed
    if (FormulaShape._cssCache !== null &&
        FormulaShape._cssCacheEmbedFonts === embedFonts) {
      return FormulaShape._cssCache;
    }

    // Build the promise and cache it immediately (so concurrent calls share it)
    FormulaShape._cssCacheEmbedFonts = embedFonts;
    FormulaShape._cssCache = FormulaShape._buildCSS(embedFonts);
    return FormulaShape._cssCache;
  }

  static async _buildCSS(embedFonts) {
    // Step 1: get raw CSS text from every stylesheet
    const sheetEntries = []; // { href, textPromise }
    for (const sheet of document.styleSheets) {
      const href = sheet.href;
      let textPromise;
      try {
        // Same-origin: read cssRules directly
        const rules = [...(sheet.cssRules || sheet.rules || [])];
        textPromise = Promise.resolve(rules.map(r => r.cssText).join('\n'));
      } catch(_) {
        // Cross-origin (e.g. KaTeX CDN): fetch the raw text
        textPromise = href
          ? fetch(href).then(r => r.ok ? r.text() : '').catch(() => '')
          : Promise.resolve('');
      }
      sheetEntries.push({ href: href || location.href, textPromise });
    }

    const sheetTexts = await Promise.all(sheetEntries.map(e => e.textPromise));

    // Step 2: rewrite relative font url()s — either to data-URIs or absolute URLs
    const FONT_EXT = /\.(woff2?|ttf|otf|eot)(\?[^"')]*)?$/i;
    const urlRe    = /url\(["']?([^"')]+)["']?\)/g;

    // Per-build font cache to deduplicate fetches within a single export
    const fontCache = new Map();
    async function toDataUri(absUrl) {
      if (fontCache.has(absUrl)) return fontCache.get(absUrl);
      const p = fetch(absUrl)
        .then(r => r.ok ? r.blob() : null)
        .then(blob => blob ? new Promise(res => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(blob);
        }) : null)
        .catch(() => null);
      fontCache.set(absUrl, p);
      return p;
    }

    const processedParts = await Promise.all(sheetTexts.map(async (css, i) => {
      if (!css) return '';
      const base = sheetEntries[i].href;

      const matches = [...css.matchAll(urlRe)];
      const replacements = new Map();

      await Promise.all(matches.map(async m => {
        const rawUrl = m[1];
        if (!FONT_EXT.test(rawUrl) || rawUrl.startsWith('data:')) return;
        try {
          const absUrl = new URL(rawUrl, base).href;
          if (embedFonts) {
            const dataUri = await toDataUri(absUrl);
            if (dataUri) replacements.set(m[0], `url("${dataUri}")`);
          } else {
            // Just rewrite to absolute URL — no download needed
            replacements.set(m[0], `url("${absUrl}")`);
          }
        } catch(_) {}
      }));

      // Apply replacements
      for (const [orig, repl] of replacements) {
        css = css.split(orig).join(repl);
      }
      return css;
    }));

    return processedParts.join('\n');
  }

  /**
   * Build a self-contained SVG data-URI for the formula.
   *
   * WHY NO CANVAS:
   *   Drawing an SVG containing <foreignObject> onto a canvas permanently
   *   taints it → toDataURL() throws SecurityError. This cannot be bypassed.
   *   We return a  data:image/svg+xml  URI directly instead.
   */
  async rasterise(options = {}) {
    const embedFonts = options.embedFonts ?? true;
    if (!this._wrap) return null;
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;

      const w = Math.max(20, parseFloat(this._fo.getAttribute('width'))  || this.width);
      const h = Math.max(20, parseFloat(this._fo.getAttribute('height')) || this.height);

      // Collect CSS (handles cross-origin sheets + converts fonts to data-URIs)
      const cssText = await FormulaShape._collectCSS(embedFonts);

      // Clone, strip .katex-mathml (hidden in DOM but leaks in SVG foreignObject),
      // and set explicit dimensions for the serialised HTML.
      const clone = this._wrap.cloneNode(true);
      clone.style.cssText  = this._wrap.style.cssText;
      clone.style.width    = w + 'px';
      clone.style.height   = h + 'px';
      clone.style.display  = 'flex';
      clone.style.position = 'relative';
      clone.style.overflow = 'visible';
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      clone.querySelectorAll('.katex-mathml').forEach(el => el.remove());

      const xhtmlSrc = new XMLSerializer().serializeToString(clone);

      const hasBg = this.bgFill && this.bgFill !== 'transparent';
      const parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"',
        `     viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
        '  <defs>',
        `    <style><![CDATA[${cssText}]]></style>`,
        '  </defs>',
      ];
      if (hasBg) parts.push(`  <rect width="${w}" height="${h}" fill="${this.bgFill}"/>`);
      parts.push(
        `  <foreignObject x="0" y="0" width="${w}" height="${h}">`,
        `    ${xhtmlSrc}`,
        '  </foreignObject>',
        '</svg>',
      );

      const svgSrc = parts.join('\n');
      return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgSrc)));

    } catch(e) {
      console.error('Formula rasterise failed:', e);
      return null;
    }
  }

  hitTest(wx, wy) {
    return this._pointInRotatedBBox(wx, wy);
  }

  serialize() {
    return {
      ...super.serialize(),
      latex: this.latex, display: this.display,
      fontSize: this.fontSize, textColor: this.textColor,
      bgFill: this.bgFill,
    };
  }

  static deserialize(data) { return new FormulaShape(data); }
}
