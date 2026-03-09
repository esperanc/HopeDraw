import { Events } from '../core/Events.js';
import {
  AddShapeCommand, RemoveShapesCommand, MoveShapesCommand,
  TransformCommand, GroupCommand, UngroupCommand
} from '../core/CommandManager.js';
import { GroupShape } from '../shapes/GroupShape.js';

/**
 * Select tool – handles:
 *   - Click to select shapes
 *   - Shift-click for multi-select
 *   - Drag to move
 *   - Drag handles to resize/rotate
 *   - Double-click to enter text edit mode
 *   - Rubber-band selection
 */
export class SelectTool {
  constructor(app) {
    this.app = app;
    this._state  = 'idle'; // idle | selecting | moving | handle | rubber
    this._start  = null;
    this._snapshots = null;
    this._activeHandle = null;
    this._rubberEl = null;
  }

  activate() { this.app.canvas.svg.style.cursor = 'default'; }
  deactivate() {}

  onPointerDown(wx, wy, e) {
    const app = this.app;
    const handle = app.selection.hitHandle(wx, wy);

    if (handle) {
      // Begin handle transform
      this._state = 'handle';
      this._activeHandle = handle;
      this._start = { wx, wy };
      this._selBBox = { ...app.selection._selBBox };
      
      if (handle !== 'ROTATE') {
        const selRot = this._selBBox.rotation ?? 0;
        const shapes = app.selection.selectedShapes();
        shapes.forEach(s => this._upgradeShearables(s, null, 0, selRot));
      }
      
      const postUpgradeShapes = app.selection.selectedShapes();
      this._snapshots = { before: new Map(postUpgradeShapes.map(s => [s.id, s.snapshotState()])) };
      app.canvas.svg.setPointerCapture?.(e.pointerId);
      return;
    }

    // Hit test shapes (reverse: topmost first)
    const hit = this._hitTestShapes(wx, wy);

    if (hit) {
      if (!app.selection.hasSelectedFor(hit.id)) {
        app.selection.select(hit.id, e.shiftKey);
      } else if (e.shiftKey) {
        app.selection.deselect(hit.id);
        return;
      }
      this._state = 'moving';
      this._start = { wx, wy };
      const shapes = app.selection.selectedShapes();
      this._snapshots = { before: new Map(shapes.map(s => [s.id, s.snapshotState()])) };
      app.canvas.svg.setPointerCapture?.(e.pointerId);
    } else {
      // Clear selection + rubber band
      if (!e.shiftKey) app.selection.clear();
      this._state = 'rubber';
      this._start = { wx, wy };
      this._startRubber(wx, wy);
    }
  }

  onPointerMove(wx, wy, e) {
    if (this._state === 'moving') {
      const dx = wx - this._start.wx;
      const dy = wy - this._start.wy;
      app.selection.selectedShapes().forEach(s => {
        const snap = this._snapshots.before.get(s.id);
        if (!snap) return;
        const tdx = snap.x !== undefined ? (snap.x + dx - s.x) : (snap.x1 + dx - s.x);
        const tdy = snap.y !== undefined ? (snap.y + dy - s.y) : 0;
        s.translate(tdx, tdy);
      });
      app.selection.refresh();
    } else if (this._state === 'handle') {
      this._applyHandle(wx, wy);
      app.selection.refresh();
    } else if (this._state === 'rubber') {
      this._updateRubber(wx, wy);
    }
  }

  onPointerMove(wx, wy, e) {
    const app = this.app;
    if (this._state === 'moving') {
      const canvas = app.canvas;
      app.selection.selectedShapes().forEach(s => {
        const snap = this._snapshots.before.get(s.id);
        if (!snap) return;
        s.applyState(snap);
        // Snap the shape's anchor position to the grid rather than the raw delta,
        // so the shape's own origin lands on a grid line regardless of where it was grabbed.
        const rawX = (snap.x  ?? snap.x1 ?? 0) + (wx - this._start.wx);
        const rawY = (snap.y  ?? snap.y1 ?? 0) + (wy - this._start.wy);
        const snappedX = canvas.snap(rawX);
        const snappedY = canvas.snap(rawY);
        const tdx = snappedX - (snap.x ?? snap.x1 ?? 0);
        const tdy = snappedY - (snap.y ?? snap.y1 ?? 0);
        s.translate(tdx, tdy);
      });
      app.selection.refresh();
    } else if (this._state === 'handle') {
      this._applyHandle(wx, wy);
      if (this._activeHandle === 'ROTATE') {
        // Rotate the handle wrapper group as a rigid frame — no DOM rebuild.
        const delta = this._snapshots.rotDelta ?? 0;
        const bb    = this._selBBox;
        if (bb) app.selection.previewRotation(delta, bb.cx, bb.cy);
      } else {
        app.selection.refresh();
      }
    } else if (this._state === 'rubber') {
      this._updateRubber(wx, wy);
    }
  }

  onPointerUp(wx, wy, e) {
    const app = this.app;
    if (this._state === 'moving') {
      const shapes = app.selection.selectedShapes();
      const after  = new Map(shapes.map(s => [s.id, s.snapshotState()]));
      const before = this._snapshots.before;
      // Check actual movement
      const moved = shapes.some(s => {
        const b = before.get(s.id), a = after.get(s.id);
        return b && a && (b.x !== a.x || b.y !== a.y);
      });
      if (moved) {
        app.commands.execute({
          label: 'Move',
          execute: () => { shapes.forEach(s => { s.applyState(after.get(s.id)); s.render(); }); app.selection.refresh(); },
          undo:    () => { shapes.forEach(s => { s.applyState(before.get(s.id)); s.render(); }); app.selection.refresh(); },
        });
      }
    } else if (this._state === 'handle') {
      const shapes = app.selection.selectedShapes();
      const after  = new Map(shapes.map(s => [s.id, s.snapshotState()]));
      app.commands.execute({
        label: 'Transform',
        execute: () => { shapes.forEach(s => { s.applyState(after.get(s.id)); s.render(); }); app.selection.refresh(); },
        undo:    () => { shapes.forEach(s => { s.applyState(this._snapshots.before.get(s.id)); s.render(); }); app.selection.refresh(); },
      });
    } else if (this._state === 'rubber') {
      this._finishRubber(wx, wy, e.shiftKey);
    }
    this._state = 'idle';
    this._snapshots = null;
  }

  onDblClick(wx, wy, e) {
    const hit = this._hitTestShapes(wx, wy);
    if (!hit) return;
    if (hit.type === 'text') {
      hit.enterEditMode();
      // exit on click outside
      const handler = (ev) => {
        if (!hit.el?.contains(ev.target)) {
          hit.exitEditMode();
          document.removeEventListener('pointerdown', handler, true);
          this.app.bus.emit(Events.SHAPE_UPDATED, { shape: hit });
        }
      };
      document.addEventListener('pointerdown', handler, true);
    } else if (hit.type === 'formula') {
      this.app.openFormulaEditor(hit);
    } else if (hit.type === 'path') {
      // Enter node-edit mode for this path
      const editTool = this.app.tools['path-edit'];
      if (editTool) {
        // Bypass normal setActiveTool so the toolbar doesn't change visually
        if (this.app._activeTool?.deactivate) this.app._activeTool.deactivate();
        this.app._activeTool     = editTool;
        this.app._activeToolName = 'path-edit';
        this.app.canvas.setActiveTool(editTool);
        editTool.editShape(hit);
      }
    } else if (hit.type === 'line') {
      // Enter endpoint-edit mode for this line
      const editTool = this.app.tools['line-edit'];
      if (editTool) {
        if (this.app._activeTool?.deactivate) this.app._activeTool.deactivate();
        this.app._activeTool     = editTool;
        this.app._activeToolName = 'line-edit';
        this.app.canvas.setActiveTool(editTool);
        editTool.editShape(hit);
      }
    }
  }


  onKeyDown(e) {
    const app = this.app;
    const shapes = app.selection.selectedShapes();
    if (!shapes.length) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement?.contentEditable === 'true') return;
      e.preventDefault();
      app.commands.execute(new RemoveShapesCommand(app, shapes));
      app.selection.clear();
    } else if (e.key === 'ArrowLeft') {
      const dx = e.shiftKey ? -10 : -1;
      app.commands.execute(new MoveShapesCommand(app, shapes, dx, 0));
      app.selection.refresh();
    } else if (e.key === 'ArrowRight') {
      const dx = e.shiftKey ? 10 : 1;
      app.commands.execute(new MoveShapesCommand(app, shapes, dx, 0));
      app.selection.refresh();
    } else if (e.key === 'ArrowUp') {
      const dy = e.shiftKey ? -10 : -1;
      app.commands.execute(new MoveShapesCommand(app, shapes, 0, dy));
      app.selection.refresh();
    } else if (e.key === 'ArrowDown') {
      const dy = e.shiftKey ? 10 : 1;
      app.commands.execute(new MoveShapesCommand(app, shapes, 0, dy));
      app.selection.refresh();
    }
  }

  // ─── Handle Transform ────────────────────────────────────────────────────

  _applyHandle(wx, wy) {
    const shapes = this.app.selection.selectedShapes();
    if (!shapes.length) return;
    const bb = this._selBBox;
    if (!bb) return;
    const handle = this._activeHandle;
    const canvas = this.app.canvas;

    if (shapes.length === 1 && typeof shapes[0].dragHandle === 'function') {
      const isStandardHandle = ['TL','T','TR','ML','MR','BL','B','BR','ROTATE'].includes(handle);
      if (!isStandardHandle) {
        shapes[0].dragHandle(handle, wx, wy, this._snapshots);
        // Force an immediate DOM update so the Arc angles preview instantly
        shapes[0].render();
        this.app.selection.refresh();
        return;
      }
    }

    if (handle === 'ROTATE') {
      // Rotation is intentionally left un-snapped (angle snapping is a separate feature)
      const angle = Math.atan2(wy - bb.cy, wx - bb.cx) * 180 / Math.PI + 90;
      if (!this._snapshots.startAngle) this._snapshots.startAngle = angle;
      const delta = angle - this._snapshots.startAngle;
      this._snapshots.rotDelta = delta;   // read by onPointerMove for preview

      const r   = delta * Math.PI / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      const rotatePt = (px, py) => {
        const dx = px - bb.cx, dy = py - bb.cy;
        return [bb.cx + dx*cos - dy*sin, bb.cy + dx*sin + dy*cos];
      };

      shapes.forEach(s => {
        const snap = this._snapshots.before.get(s.id);
        if (!snap) return;
        s.applyState(snap);   // restore pre-drag state

        if (s.type === 'group' || s.type === 'path') {
          // Groups and paths bake rotation into children / nodes
          s.rotate(delta, bb.cx, bb.cy);
        } else if (shapes.length > 1) {
          // Multi-select: rotate each shape's centre around the shared pivot
          if (s.type === 'line') {
            [s.x,  s.y]  = rotatePt(snap.x,  snap.y);
            [s.x2, s.y2] = rotatePt(snap.x2 ?? s.x2, snap.y2 ?? s.y2);
            if (snap.cpx != null) [s.cpx, s.cpy] = rotatePt(snap.cpx, snap.cpy);
          } else {
            const origCx = (snap.x ?? 0) + (snap.width  ?? 0) / 2;
            const origCy = (snap.y ?? 0) + (snap.height ?? 0) / 2;
            const [newCx, newCy] = rotatePt(origCx, origCy);
            s.x = newCx - s.width  / 2;
            s.y = newCy - s.height / 2;
            s.rotation = ((snap.rotation ?? 0) + delta + 360) % 360;
          }
          s.render();
        } else {
          // Single non-group shape: rotate around its own centre
          if (s.type === 'line') {
            // LineShape ignores `rotation` — must rotate actual endpoints
            [s.x,  s.y]  = rotatePt(snap.x,  snap.y);
            [s.x2, s.y2] = rotatePt(snap.x2 ?? s.x2, snap.y2 ?? s.y2);
            if (snap.cpx != null) [s.cpx, s.cpy] = rotatePt(snap.cpx, snap.cpy);
          } else {
            s.rotation = ((snap.rotation ?? 0) + delta + 360) % 360;
          }
          s.render();
        }
      });
      return;
    }

    // ── Resize ──────────────────────────────────────────────────────────────
    // Snap the mouse pointer to the grid before feeding it into the resize math,
    // so the dragged edge/corner lands on a grid line.
    wx = canvas.snap(wx);
    wy = canvas.snap(wy);

    // For rotated bboxes, unrotate the mouse into the bbox's local coordinate
    // space first, so the axis-aligned math below works correctly.
    let { x, y, w, h } = bb;
    let rx = wx, ry = wy;
    if (bb.rotation) {
      const r   = -bb.rotation * Math.PI / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      const dx  = wx - bb.cx, dy = wy - bb.cy;
      rx = bb.cx + dx * cos - dy * sin;
      ry = bb.cy + dx * sin + dy * cos;
    }

    if (handle.includes('R')) w = rx - x;
    if (handle.includes('L')) { w = (x + w) - rx; x = rx; }
    if (handle.includes('B')) h = ry - y;
    if (handle.includes('T')) { h = (y + h) - ry; y = ry; }

    const scaleX = (w || 1) / (bb.w || 1);
    const scaleY = (h || 1) / (bb.h || 1);

    // Calculate anti-drift. Scaling the unrotated bounding box shifts its center.
    // When the shape is presented with rotation, this shifts the rotation pivot in world space,
    // which effectively pulls the physical anchor corner away from its rightful fixed location.
    let driftX = 0, driftY = 0;
    if (bb.rotation) {
      const oldCx = bb.x + bb.w / 2;
      const oldCy = bb.y + bb.h / 2;
      const newCx = x + w / 2;
      const newCy = y + h / 2;
      
      const dCx = newCx - oldCx;
      const dCy = newCy - oldCy;
      
      const rad = bb.rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      
      driftX = dCx * (cos - 1) - dCy * sin;
      driftY = dCy * (cos - 1) + dCx * sin;
    }

    const anchorX = bb.x + (handle.includes('L') ? bb.w : 0);
    const anchorY = bb.y + (handle.includes('T') ? bb.h : 0);

    shapes.forEach(s => {
      const snap = this._snapshots.before.get(s.id);
      if (!snap) return;
      s.applyState(snap);

      if (s.type === 'group' || s.type === 'path') {
        // Groups store layout in _cachedBBox and have children at world positions.
        // Paths store nodes with world positions.
        // If the multi-selection BB is unrotated, force scale across World Theta = 0.
        const dragHasRotation = !!bb.rotation;
        const scaleTheta = dragHasRotation ? (s.rotation ?? 0) : 0;
        
        s.resize(anchorX, anchorY, scaleX, scaleY, scaleTheta);
        // Correct the rotation pivot drift in world space!
        if (driftX !== 0 || driftY !== 0) s.translate(driftX, driftY);
        return;
      }

      const ox = snap.x ?? snap.x1 ?? s.x;
      const oy = snap.y ?? s.y;
      
      if (snap.width !== undefined) {
        // Find original visual center
        const cx = ox + snap.width / 2;
        const cy = oy + snap.height / 2;
        
        // Scale the visual center dynamically around the unrotated world anchor
        const newCx = anchorX + (cx - anchorX) * scaleX;
        const newCy = anchorY + (cy - anchorY) * scaleY;

        // Obtain relative rotation projection against world-aligned bounds and apply Euclidean scale hypotenuse map
        const A = ((snap.rotation ?? 0) - (bb.rotation ?? 0)) * Math.PI / 180;
        const scaleW = Math.hypot(scaleX * Math.cos(A), scaleY * Math.sin(A));
        const scaleH = Math.hypot(scaleX * Math.sin(A), scaleY * Math.cos(A));
        
        s.width = Math.max(2, Math.abs(snap.width * scaleW));
        s.height = Math.max(2, Math.abs(snap.height * scaleH));
        s.x = newCx - s.width / 2;
        s.y = newCy - s.height / 2;
      } else {
        s.x = anchorX + (ox - anchorX) * scaleX;
        s.y = anchorY + (oy - anchorY) * scaleY;
      }

      // For line endpoints, snap them individually as well
      if (snap.x2 !== undefined) {
        s.x2 = canvas.snap(anchorX + (snap.x2 - anchorX) * scaleX);
      }
      if (snap.y2 !== undefined) {
        s.y2 = canvas.snap(anchorY + (snap.y2 - anchorY) * scaleY);
      }
      
      if (driftX !== 0 || driftY !== 0) s.translate(driftX, driftY);
      s.render();
    });
  }

  // ─── Rubber Band ──────────────────────────────────────────────────────────

  _startRubber(wx, wy) {
    this._rubberEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this._rubberEl.setAttribute('fill', 'rgba(108,99,255,0.1)');
    this._rubberEl.setAttribute('stroke', '#6c63ff');
    this._rubberEl.setAttribute('stroke-width', 1 / this.app.canvas.zoom);
    this._rubberEl.setAttribute('stroke-dasharray', `${4/this.app.canvas.zoom} ${2/this.app.canvas.zoom}`);
    this._rubberEl.setAttribute('pointer-events', 'none');
    this.app.canvas.handlesLayer.appendChild(this._rubberEl);
    this._rubberStart = { wx, wy };
  }

  _updateRubber(wx, wy) {
    if (!this._rubberEl) return;
    const x = Math.min(wx, this._rubberStart.wx);
    const y = Math.min(wy, this._rubberStart.wy);
    const w = Math.abs(wx - this._rubberStart.wx);
    const h = Math.abs(wy - this._rubberStart.wy);
    this._rubberEl.setAttribute('x', x); this._rubberEl.setAttribute('y', y);
    this._rubberEl.setAttribute('width', w); this._rubberEl.setAttribute('height', h);
  }

  _finishRubber(wx, wy, additive) {
    if (this._rubberEl) { this._rubberEl.remove(); this._rubberEl = null; }
    const rs = this._rubberStart;
    if (!rs) return;
    const rx1 = Math.min(wx, rs.wx), ry1 = Math.min(wy, rs.wy);
    const rx2 = Math.max(wx, rs.wx), ry2 = Math.max(wy, rs.wy);
    if (rx2 - rx1 < 3 && ry2 - ry1 < 3) return; // too small, treat as click

    const ids = [];
    this.app.shapes.forEach(s => {
      const bb = s.getBBox();
      if (!bb) return;
      if (bb.x >= rx1 && bb.y >= ry1 && bb.x + bb.w <= rx2 && bb.y + bb.h <= ry2) {
        ids.push(s.id);
      }
    });
    if (ids.length) this.app.selection.selectMany(ids);
  }

  // ─── Hit Test ─────────────────────────────────────────────────────────────

  _hitTestShapes(wx, wy) {
    // Test in reverse z-order (topmost first)
    const visIds = this.app.layers.visibleShapeIds;
    for (let i = visIds.length - 1; i >= 0; i--) {
      const id = visIds[i];
      const s = this.app.shapes.get(id);
      if (!s) continue;
      const layer = this.app.layers.getLayer(s.layerId);
      if (layer?.locked) continue;
      if (s.hitTest(wx, wy)) return s;
    }
    return null;
  }
  
  // ─── Shape Shear Upgrading ────────────────────────────────────────────────
  
  _upgradeShearables(shape, parentGroup, contextRot, selRot) {
    if (shape.type === 'group') {
      const currentRot = shape.rotation ?? 0;
      [...shape.children].forEach(child => {
        this._upgradeShearables(child, shape, contextRot + currentRot, selRot);
      });
    } else {
      const absRot = (shape.rotation ?? 0) + contextRot;
      const relRot = absRot - selRot;
      const normalized = Math.abs(relRot % 90);
      if (normalized > 0.001 && normalized < 89.999) {
        this._upgradePrimitiveToPath(shape, parentGroup);
      }
    }
  }

  _upgradePrimitiveToPath(shape, parentGroup) {
    if (typeof shape.toPathShape !== 'function') return shape;
    const path = shape.toPathShape();
    
    this.app.shapes.delete(shape.id);
    this.app.shapes.set(path.id, path);
    
    if (parentGroup) {
      const idx = parentGroup.children.indexOf(shape);
      if (idx !== -1) {
        parentGroup.children[idx] = path;
        parentGroup.childIds[idx] = path.id;
      }
      if (shape.el && parentGroup.el) {
        const next = shape.el.nextSibling;
        shape.unmount();
        path.mount(parentGroup.el);
        if (next) parentGroup.el.insertBefore(path.el, next);
      }
    } else {
      const layer = this.app.layers.getLayer(shape.layerId);
      if (layer) {
        const idx = layer.shapeIds.indexOf(shape.id);
        if (idx !== -1) layer.shapeIds[idx] = path.id;
      }
      if (shape.el && shape.el.parentNode) {
        const parent = shape.el.parentNode;
        const next = shape.el.nextSibling;
        shape.unmount();
        path.mount(parent);
        if (next) parent.insertBefore(path.el, next);
      }
    }
    
    if (this.app.selection.hasSelectedFor(shape.id)) {
      this.app.selection._ids.delete(shape.id);
      this.app.selection._ids.add(path.id);
    }
    
    return path;
  }
}
