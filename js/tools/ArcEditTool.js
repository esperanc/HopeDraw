/**
 * ArcEditTool — angle-handle editing mode for ArcShape objects.
 *
 * Activated by SelectTool's double-click on an arc shape.
 * Hides the normal bbox/resize handles and shows only the two orange
 * ARC_START / ARC_END angle handles, identical to the SelectionManager's
 * arc-edit mode but now driven by a dedicated active tool so that all
 * pointer events are routed here exclusively.
 *
 * Escape or click outside → exit back to select mode
 */
export class ArcEditTool {
  constructor(app) {
    this.app       = app;
    this._arc      = null;
    this._state    = 'idle';   // idle | dragging
    this._handle   = null;     // 'ARC_START' | 'ARC_END'
    this._snapshot = null;     // state before current drag
    this._onKey    = this._onKey.bind(this);
  }

  /** Called from SelectTool.onDblClick to enter arc-angle-edit mode */
  editShape(arc) {
    this._arc = arc;
    this.app.selection.select(arc.id);
    this.app.selection.enterArcEditMode();
    this.app.canvas.svg.style.cursor = 'default';
    document.addEventListener('keydown', this._onKey, true);
  }

  activate() { /* entry is via editShape() */ }

  deactivate() {
    document.removeEventListener('keydown', this._onKey, true);
    if (this.app.selection.isArcEditMode) {
      this.app.selection.exitArcEditMode();
    }
    // Restore normal selection so the arc stays selected with full handles
    if (this._arc) {
      this.app.selection.select(this._arc.id);
    }
    this._arc      = null;
    this._state    = 'idle';
    this._handle   = null;
    this._snapshot = null;
  }

  // ─── Keyboard ────────────────────────────────────────────────────────────

  _onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.app.setActiveTool('select');
    }
  }

  // ─── Pointer Events ───────────────────────────────────────────────────────

  onPointerDown(wx, wy, e) {
    if (e.button !== 0) return;

    const handle = this.app.selection.hitHandle(wx, wy, e);

    // Only react to the two custom arc handles
    if (handle === 'ARC_START' || handle === 'ARC_END') {
      this._state    = 'dragging';
      this._handle   = handle;
      this._snapshot = this._arc.snapshotState();
      this.app.canvas.svg.setPointerCapture?.(e.pointerId);
      return;
    }

    // Clicked outside any arc handle → exit to select tool
    this.app.setActiveTool('select');
  }

  onPointerMove(wx, wy, e) {
    if (this._state !== 'dragging' || !this._arc || !this._snapshot) return;

    // Restore snapshot each frame so dragHandle can compute from clean state
    this._arc.applyState(this._snapshot);
    this._arc.dragHandle(this._handle, wx, wy, {
      before: new Map([[this._arc.id, this._snapshot]]),
    });
    this._arc.render();
    this.app.selection.refresh();
  }

  onPointerUp(wx, wy, e) {
    if (this._state !== 'dragging' || !this._arc || !this._snapshot) {
      this._state = 'idle';
      return;
    }

    const before  = this._snapshot;
    const after   = this._arc.snapshotState();
    const arc     = this._arc;
    const app     = this.app;

    app.commands.execute({
      label:   'Arc angles',
      execute: () => { arc.applyState(after);  arc.render(); app.selection.refresh(); },
      undo:    () => { arc.applyState(before); arc.render(); app.selection.refresh(); },
    });

    this._state    = 'idle';
    this._snapshot = null;
  }
}
