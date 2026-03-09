export class ColorPicker {
  constructor(anchorEl, initialColor, onChange) {
    this.anchorEl = anchorEl;
    this.initialColor = initialColor || '#000000';
    this.onChange = onChange;

    this.hsv = this.parseColor(this.initialColor);
    
    this.initDOM();
    this.updateUI();
    this.position();
    
    // Close when clicking outside
    this._closeHandler = (e) => {
      if (!this.el.contains(e.target) && e.target !== this.anchorEl && !this.anchorEl.contains(e.target)) {
        this.close();
      }
    };
    // Delay adding to avoid immediate closing on the click that opened it
    setTimeout(() => {
      document.addEventListener('mousedown', this._closeHandler);
    }, 10);
  }

  initDOM() {
    this.el = document.createElement('div');
    this.el.className = 'color-picker-popup';
    
    this.el.innerHTML = `
      <div class="cp-sv-pad" id="cp-sv-pad">
        <div class="cp-sv-cursor" id="cp-sv-cursor"></div>
      </div>
      <div class="cp-sliders">
        <div class="cp-slider-wrap">
          <div class="cp-hue-slider" id="cp-hue-bg"></div>
          <input type="range" class="cp-slider" id="cp-hue" min="0" max="360" step="1">
        </div>
        <div class="cp-slider-wrap cp-alpha-wrap">
          <div class="cp-alpha-slider" id="cp-alpha-bg"></div>
          <input type="range" class="cp-slider" id="cp-alpha" min="0" max="1" step="0.01">
        </div>
      </div>
      <div class="cp-inputs">
        <input type="text" id="cp-hex" class="cp-text-input" title="Hex or RGBA">
        <button id="cp-none-btn" class="cp-btn" title="Transparent (None)">None</button>
      </div>
    `;

    document.body.appendChild(this.el);

    this.svPad = this.el.querySelector('#cp-sv-pad');
    this.svCursor = this.el.querySelector('#cp-sv-cursor');
    this.hueInput = this.el.querySelector('#cp-hue');
    this.alphaInput = this.el.querySelector('#cp-alpha');
    this.alphaBg = this.el.querySelector('#cp-alpha-bg');
    this.hexInput = this.el.querySelector('#cp-hex');
    this.noneBtn = this.el.querySelector('#cp-none-btn');

    this.bindEvents();
  }

  bindEvents() {
    const unNone = () => {
      if (this.hsv.isNone) {
        this.hsv.isNone = false;
        if (this.hsv.a === 0) this.hsv.a = 1;
      }
    };

    // Hue
    this.hueInput.addEventListener('input', () => {
      unNone();
      this.hsv.h = parseFloat(this.hueInput.value);
      this.commitChange();
    });

    // Alpha
    this.alphaInput.addEventListener('input', () => {
      this.hsv.isNone = false;
      this.hsv.a = parseFloat(this.alphaInput.value);
      this.commitChange();
    });

    // SV Pad Mouse Events
    let isDraggingSV = false;
    const updateSV = (e) => {
      unNone();
      const rect = this.svPad.getBoundingClientRect();
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      x = Math.max(0, Math.min(rect.width, x));
      y = Math.max(0, Math.min(rect.height, y));
      
      this.hsv.s = x / rect.width;
      this.hsv.v = 1 - (y / rect.height);
      this.commitChange();
    };

    this.svPad.addEventListener('mousedown', (e) => {
      isDraggingSV = true;
      updateSV(e);
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (isDraggingSV) updateSV(e);
    });

    window.addEventListener('mouseup', () => {
      isDraggingSV = false;
    });

    // Hex input
    this.hexInput.addEventListener('change', () => {
      const val = this.hexInput.value.trim();
      const newHsv = this.parseColor(val);
      if (newHsv.a !== undefined) { // valid
        this.hsv = newHsv;
        this.commitChange();
      } else {
        this.updateUI(); // revert invalid
      }
    });

    // None button
    this.noneBtn.addEventListener('click', () => {
      this.hsv.a = 0;
      this.hsv.isNone = true;
      this.commitChange();
    });
  }

  commitChange() {
    this.updateUI();
    if (this.hsv.isNone) {
      this.onChange('none');
      return;
    }
    const rgba = this.hsvaToRgba(this.hsv.h, this.hsv.s, this.hsv.v, this.hsv.a);
    if (this.hsv.a === 1) {
      this.onChange(this.rgbToHex(rgba.r, rgba.g, rgba.b));
    } else {
      this.onChange(`rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${this.hsv.a.toFixed(2)})`);
    }
  }

  updateUI() {
    if (this.hsv.isNone) {
      this.hexInput.value = 'none';
      return;
    }

    const rgba = this.hsvaToRgba(this.hsv.h, this.hsv.s, this.hsv.v, this.hsv.a);
    const pureHue = this.hsvaToRgba(this.hsv.h, 1, 1, 1);
    
    // SV Pad background (Pure Hue)
    this.svPad.style.backgroundColor = `rgb(${pureHue.r}, ${pureHue.g}, ${pureHue.b})`;
    
    // SV Cursor position
    const rect = this.svPad.getBoundingClientRect();
    const cursorW = 12; // approximate cursor width
    // Just use percentages if rect implies 0 before rendering
    this.svCursor.style.left = `${this.hsv.s * 100}%`;
    this.svCursor.style.top = `${(1 - this.hsv.v) * 100}%`;

    // Sliders
    this.hueInput.value = this.hsv.h;
    this.alphaInput.value = this.hsv.a;

    // Alpha slider background
    const rgbStr = `${rgba.r}, ${rgba.g}, ${rgba.b}`;
    this.alphaBg.style.background = `linear-gradient(to right, rgba(${rgbStr}, 0), rgba(${rgbStr}, 1))`;

    // Hex Input
    if (this.hsv.a === 1) {
      this.hexInput.value = this.rgbToHex(rgba.r, rgba.g, rgba.b);
    } else {
      this.hexInput.value = `rgba(${rgbStr}, ${this.hsv.a.toFixed(2)})`;
    }
  }

  position() {
    const rect = this.anchorEl.getBoundingClientRect();
    const myRect = this.el.getBoundingClientRect();
    
    let left = rect.left - myRect.width - 10;
    if (left < 0) left = rect.right + 10;
    
    let top = rect.top;
    if (top + myRect.height > window.innerHeight) {
      top = window.innerHeight - myRect.height - 10;
    }
    
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  close() {
    if (this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
    document.removeEventListener('mousedown', this._closeHandler);
  }

  // --- Color Utils ---

  parseColor(str) {
    if (!str || str === 'none' || str === 'transparent') {
      return { h: 0, s: 0, v: 0, a: 0, isNone: true };
    }
    
    let r = 0, g = 0, b = 0, a = 1;
    str = str.trim();

    if (str.startsWith('#')) {
      const hex = str.replace('#', '');
      if (hex.length === 3) {
        r = parseInt(hex.charAt(0) + hex.charAt(0), 16);
        g = parseInt(hex.charAt(1) + hex.charAt(1), 16);
        b = parseInt(hex.charAt(2) + hex.charAt(2), 16);
      } else if (hex.length === 6) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
      } else if (hex.length === 8) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
        a = parseInt(hex.substring(6, 8), 16) / 255;
      }
    } else if (str.startsWith('rgb')) {
      const parts = str.match(/[\\d.]+/g);
      if (parts && parts.length >= 3) {
        r = parseInt(parts[0]);
        g = parseInt(parts[1]);
        b = parseInt(parts[2]);
        if (parts.length >= 4) a = parseFloat(parts[3]);
      }
    }

    return this.rgbaToHsva(r, g, b, a);
  }

  rgbaToHsva(r, g, b, a) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;

    if (max !== min) {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: Math.round(h * 360), s, v, a, isNone: false };
  }

  hsvaToRgba(h, s, v, a) {
    let r, g, b;
    h /= 360;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
    }
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
      a: a
    };
  }

  rgbToHex(r, g, b) {
    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
  }
}
