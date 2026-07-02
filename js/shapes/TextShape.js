import { Shape } from './Shape.js';

/**
 * Multi-line text shape using SVG <foreignObject> with a contenteditable div.
 * Supports font family, size, bold, italic, underline, alignment.
 */
export class TextShape extends Shape {
  constructor(data = {}) {
    super({ type: 'text', fill: 'transparent', stroke: 'transparent', strokeWidth: 0, ...data });
    this.content    = data.content    ?? '<p>Text</p>';
    this.fontFamily = data.fontFamily ?? 'Inter, sans-serif';
    this.fontSize   = data.fontSize   ?? 18;
    this.fontWeight = data.fontWeight ?? 'normal'; // 'normal'|'bold'
    this.fontStyle  = data.fontStyle  ?? 'normal'; // 'normal'|'italic'
    this.textDecoration = data.textDecoration ?? 'none';
    this.textColor  = data.textColor  ?? '#e8e8f0';
    this.textAlign  = data.textAlign  ?? 'left';
    this.bgFill     = data.bgFill     ?? 'transparent';
    this.borderColor = data.borderColor ?? 'transparent';
    this.editing    = false;
    // True while the shape still shows its auto-generated placeholder text,
    // so the first keystroke can wipe it instead of appending to it.
    this.isPlaceholder = data.isPlaceholder ?? false;
  }

  createElements(g) {
    this._fo = this.makeSVGEl('foreignObject');
    this._div = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    this._div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    this._div.className = 'text-shape-content';
    this._div.contentEditable = 'false';
    this._div.innerHTML = this.content;
    this._fo.appendChild(this._div);
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
    // Let pointer events reach the editable div
    this._fo.style.pointerEvents = this.editing ? 'all' : 'none';
    this.el.style.pointerEvents  = this.editing ? 'none' : 'all';



    Object.assign(this._div.style, {
      fontFamily:     this.fontFamily,
      fontSize:       this.fontSize + 'px',
      fontWeight:     this.fontWeight,
      fontStyle:      this.fontStyle,
      textDecoration: this.textDecoration,
      color:          this.textColor,
      textAlign:      this.textAlign,
      background:     (this.bgFill === 'none') ? 'transparent' : (this.bgFill || 'transparent'),
      border:         this.editing ? '2px solid #6c63ff'
                    : (this.borderColor !== 'transparent' ? `2px solid ${this.borderColor}` : 'none'),
      width:          '100%',
      height:         '100%',
      boxSizing:      'border-box',
      padding:        '6px 8px',
      wordBreak:      'normal',
      // 'pre' means the text never auto-wraps: the box shrink-wraps to the
      // longest line and new lines only come from Enter. This also avoids the
      // scrollbar/word-break cascade that would force-wrap tight-fit text.
      whiteSpace:     'pre',
      outline:        'none',
      overflow:       'hidden',
      userSelect:     this.editing ? 'text' : 'none',
      cursor:         this.editing ? 'text' : 'default',
    });
  }

  /**
   * Enter inline edit mode.
   * @param onChange optional callback fired after each edit (e.g. to refresh
   *                 selection handles as the auto-fitting box changes size).
   */
  enterEditMode(onChange) {
    this.editing = true;
    this._div.contentEditable = 'true';
    this.render();
    this._div.focus();

    const range = document.createRange();
    const sel = window.getSelection();
    if (this.isPlaceholder) {
      // Select the whole placeholder so the first keystroke replaces it.
      range.selectNodeContents(this._div);
    } else {
      // Place cursor at end.
      range.selectNodeContents(this._div);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);

    // Wipe the placeholder and keep the box tightly fitted while typing.
    this._onInput = () => {
      this.isPlaceholder = false;
      this.autoFit();
      onChange?.();
    };
    this._div.addEventListener('input', this._onInput);
  }

  exitEditMode() {
    if (this._onInput) {
      this._div.removeEventListener('input', this._onInput);
      this._onInput = null;
    }
    this.editing = false;
    this.content = this._div.innerHTML;
    this._div.contentEditable = 'false';
    this.render();
  }

  /**
   * Resize the bounding box to hug the current text content: width follows the
   * widest line (no wrapping), height follows the number of lines. The anchor
   * (top-left) stays put; the box grows/shrinks right and down.
   */
  autoFit() {
    const div = this._div, fo = this._fo;
    if (!div || !fo) return;
    const MIN_W = 24, MIN_H = 24;

    // Measure on an off-screen clone. Measuring the live element is unreliable
    // because it lives inside an <foreignObject>, whose fixed width distorts
    // intrinsic (max-content) sizing. The clone carries the same class and
    // inline styles, so font, line-height and padding all match the real box.
    const m = div.cloneNode(true);
    m.style.cssText = div.style.cssText;
    Object.assign(m.style, {
      position: 'absolute', left: '-99999px', top: '0', visibility: 'hidden',
      // inline-block shrink-wraps to the content instead of filling the parent.
      display: 'inline-block',
      width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none',
      overflow: 'visible', whiteSpace: 'pre',   // no wrapping → widest line
    });
    document.body.appendChild(m);
    // offsetWidth/Height are border-box (include the padding), matching the
    // real box which also uses border-box + white-space: pre.
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    document.body.removeChild(m);

    this.width  = Math.max(MIN_W, w + 1); // +1 absorbs sub-pixel rounding
    this.height = Math.max(MIN_H, h);
    fo.setAttribute('width',  this.width);
    fo.setAttribute('height', this.height);

    this.render();
  }

  hitTest(wx, wy) {
    return this._pointInRotatedBBox(wx, wy);
  }

  serialize() {
    return {
      ...super.serialize(),
      content: this.editing ? this._div.innerHTML : this.content,
      fontFamily: this.fontFamily, fontSize: this.fontSize,
      fontWeight: this.fontWeight, fontStyle: this.fontStyle,
      textDecoration: this.textDecoration, textColor: this.textColor,
      textAlign: this.textAlign, bgFill: this.bgFill,
      borderColor: this.borderColor,
    };
  }

  /** Rasterize text DOM node to high-resolution base64 PNG for SVG export */
  async rasterise() {
    if (!this._div || typeof window.html2canvas === 'undefined') return null;
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;

      // Clone to a temporary div on the body
      const tmp = document.createElement('div');
      Object.assign(tmp.style, {
        position: 'absolute', top: '-9999px', left: '-9999px',
        width:  this._fo.getAttribute('width') + 'px',
        height: this._fo.getAttribute('height') + 'px',
        padding: '0', margin: '0', overflow: 'hidden'
      });
      
      const clone = this._div.cloneNode(true);
      clone.style.cssText = this._div.style.cssText;
      clone.style.width = '100%';
      clone.style.height = '100%';
      clone.style.overflow = 'hidden'; // Hide scrollbars during capture
      
      tmp.appendChild(clone);
      document.body.appendChild(tmp);

      const scale = 4; 
      const canvas = await window.html2canvas(clone, {
        backgroundColor: (this.bgFill === 'transparent' || this.bgFill === 'none') ? null : this.bgFill,
        scale: scale,
        useCORS: true,
        logging: false,
      });

      document.body.removeChild(tmp);
      return canvas.toDataURL('image/png');
    } catch(e) {
      console.error('Text rasterise failed:', e);
      return null;
    }
  }

  static deserialize(data) { return new TextShape(data); }
}
