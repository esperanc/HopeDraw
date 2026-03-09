import { Shape } from './Shape.js';

/**
 * LaTeX formula shape rendered via KaTeX inside a <foreignObject>.
 * For SVG export, rasterise() converts the DOM node to a PNG data-URL.
 */
export class FormulaShape extends Shape {
  constructor(data = {}) {
    super({ type: 'formula', fill: 'transparent', stroke: 'transparent', strokeWidth: 0, ...data });
    this.latex   = data.latex   ?? '\\frac{1}{2}x^2';
    this.display = data.display ?? true;  // display mode vs inline
    this.fontSize = data.fontSize ?? 18;
    this.textColor = data.textColor ?? '#e8e8f0';
    this.bgFill   = data.bgFill ?? 'transparent';
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
      color:      this.textColor,
      background: this.bgFill,
      fontSize:   this.fontSize + 'px',
      display:    'flex',
      alignItems: 'center',
      justifyContent: this.display ? 'center' : 'flex-start',
      width:      '100%',
      height:     '100%',
      overflow:   'hidden',
      boxSizing:  'border-box',
      padding:    '4px',
    });

    try {
      this._wrap.innerHTML = window.katex.renderToString(this.latex, {
        displayMode: this.display,
        throwOnError: false,
        errorColor:  '#f44',
      });
    } catch(e) {
      this._wrap.textContent = '⚠ ' + e.message;
    }
  }

  /** Rasterize formula DOM node to base64 PNG for SVG export */
  async rasterise() {
    if (!this._wrap || typeof window.html2canvas === 'undefined') return null;
    try {
      const canvas = await window.html2canvas(this._wrap, {
        backgroundColor: this.bgFill === 'transparent' ? null : this.bgFill,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      return canvas.toDataURL('image/png');
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
