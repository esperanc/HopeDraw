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
      wordBreak:      'break-word',
      whiteSpace:     'pre-wrap',
      outline:        'none',
      overflow:       'auto',
      userSelect:     this.editing ? 'text' : 'none',
      cursor:         this.editing ? 'text' : 'default',
    });
  }

  enterEditMode() {
    this.editing = true;
    this._div.contentEditable = 'true';
    this.render();
    this._div.focus();
    // Place cursor at end
    const range = document.createRange();
    range.selectNodeContents(this._div);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  exitEditMode() {
    this.editing = false;
    this.content = this._div.innerHTML;
    this._div.contentEditable = 'false';
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
