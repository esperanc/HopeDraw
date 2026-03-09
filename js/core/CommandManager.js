import { Events } from './Events.js';

const MAX_STACK = 100;

/**
 * Each command must implement:
 *   execute()  – performs the action
 *   undo()     – reverses the action
 *   label      – human-readable description (optional)
 */
export class CommandManager {
  constructor(bus) {
    this.bus = bus;
    this._undo = [];
    this._redo = [];
  }

  /** Execute a command and push it to the undo stack */
  execute(cmd) {
    cmd.execute();
    this._undo.push(cmd);
    if (this._undo.length > MAX_STACK) this._undo.shift();
    this._redo = [];
    this._notify();
  }

  undo() {
    if (!this._undo.length) return;
    const cmd = this._undo.pop();
    cmd.undo();
    this._redo.push(cmd);
    this._notify();
  }

  redo() {
    if (!this._redo.length) return;
    const cmd = this._redo.pop();
    cmd.execute();
    this._undo.push(cmd);
    this._notify();
  }

  canUndo() { return this._undo.length > 0; }
  canRedo() { return this._redo.length > 0; }

  clear() {
    this._undo = [];
    this._redo = [];
    this._notify();
  }

  _notify() {
    this.bus.emit(Events.HISTORY_CHANGED, {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoLabel: this._undo.at(-1)?.label ?? null,
      redoLabel: this._redo.at(-1)?.label ?? null,
    });
  }
}

// ─── Standard Commands ────────────────────────────────────────────────────────

export class AddShapeCommand {
  constructor(app, shape) {
    this.app = app;
    this.shape = shape;
    this.label = `Add ${shape.type}`;
  }
  execute() {
    this.app.shapes.set(this.shape.id, this.shape);
    this.app.layers.addShapeToLayer(this.shape.id, this.shape.layerId);
    this.shape.mount(this.app.canvas.shapesLayer);
    this.app.bus.emit(Events.SHAPE_ADDED, { shape: this.shape });
  }
  undo() {
    this.shape.unmount();
    this.app.shapes.delete(this.shape.id);
    this.app.layers.removeShapeFromLayer(this.shape.id, this.shape.layerId);
    this.app.bus.emit(Events.SHAPE_REMOVED, { shape: this.shape });
  }
}

export class AddShapesCommand {
  constructor(app, shapes) {
    this.app = app;
    this.shapes = shapes;
    this.label = `Add ${shapes.length} shape(s)`;
  }
  execute() {
    this.shapes.forEach(s => {
      this.app.shapes.set(s.id, s);
      this.app.layers.addShapeToLayer(s.id, s.layerId);
      s.mount(this.app.canvas.shapesLayer);
    });
    this.app.bus.emit(Events.SHAPE_ADDED, { shapes: this.shapes });
  }
  undo() {
    this.shapes.forEach(s => {
      s.unmount();
      this.app.shapes.delete(s.id);
      this.app.layers.removeShapeFromLayer(s.id, s.layerId);
    });
    this.app.bus.emit(Events.SHAPE_REMOVED, { shapes: this.shapes });
  }
}

export class RemoveShapesCommand {
  constructor(app, shapes) {
    this.app = app;
    this.shapes = shapes;
    this.label = `Delete ${shapes.length} shape(s)`;
  }
  execute() {
    this.shapes.forEach(s => {
      s.unmount();
      this.app.shapes.delete(s.id);
      this.app.layers.removeShapeFromLayer(s.id, s.layerId);
    });
    this.app.bus.emit(Events.SHAPE_REMOVED, { shapes: this.shapes });
  }
  undo() {
    this.shapes.forEach(s => {
      this.app.shapes.set(s.id, s);
      this.app.layers.addShapeToLayer(s.id, s.layerId);
      s.mount(this.app.canvas.shapesLayer);
    });
    this.app.bus.emit(Events.SHAPE_ADDED, { shapes: this.shapes });
  }
}

export class MoveShapesCommand {
  constructor(app, shapes, dx, dy) {
    this.app = app;
    this.shapes = shapes;
    this.dx = dx;
    this.dy = dy;
    this.label = 'Move';
  }
  execute() {
    this.shapes.forEach(s => s.translate(this.dx, this.dy));
    this.app.bus.emit(Events.SHAPE_UPDATED, { shapes: this.shapes });
  }
  undo() {
    this.shapes.forEach(s => s.translate(-this.dx, -this.dy));
    this.app.bus.emit(Events.SHAPE_UPDATED, { shapes: this.shapes });
  }
}

export class TransformCommand {
  /** Snapshot-based command for resize/rotate/any complex transform */
  constructor(app, shapes, snapshots) {
    this.app = app;
    this.shapes = shapes;
    this.before = snapshots.before; // Map<id, plainState>
    this.after  = snapshots.after;
    this.label = 'Transform';
  }
  execute() {
    this.shapes.forEach(s => { s.applyState(this.after.get(s.id)); s.render(); });
    this.app.bus.emit(Events.SHAPE_UPDATED, { shapes: this.shapes });
  }
  undo() {
    this.shapes.forEach(s => { s.applyState(this.before.get(s.id)); s.render(); });
    this.app.bus.emit(Events.SHAPE_UPDATED, { shapes: this.shapes });
  }
}

export class ChangePropsCommand {
  constructor(app, shape, before, after) {
    this.app = app;
    this.shape = shape;
    this.before = before;
    this.after = after;
    this.label = 'Change properties';
  }
  execute() {
    Object.assign(this.shape, this.after);
    this.shape.render();
    this.app.bus.emit(Events.SHAPE_UPDATED, { shape: this.shape });
  }
  undo() {
    Object.assign(this.shape, this.before);
    this.shape.render();
    this.app.bus.emit(Events.SHAPE_UPDATED, { shape: this.shape });
  }
}

export class GroupCommand {
  constructor(app, group, children) {
    this.app = app;
    this.group = group;
    this.children = children;
    this.label = 'Group';
  }
  execute() {
    // Remove children from top-level, add group
    this.children.forEach(s => {
      s.unmount();
      this.app.shapes.delete(s.id);
      this.app.layers.removeShapeFromLayer(s.id, s.layerId);
    });
    this.app.shapes.set(this.group.id, this.group);
    this.app.layers.addShapeToLayer(this.group.id, this.group.layerId);
    this.group.mount(this.app.canvas.shapesLayer);
    this.app.bus.emit(Events.SHAPE_ADDED, { shape: this.group });
  }
  undo() {
    this.group.unmount();
    this.app.shapes.delete(this.group.id);
    this.app.layers.removeShapeFromLayer(this.group.id, this.group.layerId);
    this.children.forEach(s => {
      this.app.shapes.set(s.id, s);
      this.app.layers.addShapeToLayer(s.id, s.layerId);
      s.mount(this.app.canvas.shapesLayer);
    });
    this.app.bus.emit(Events.SHAPE_UPDATED, {});
  }
}

export class UngroupCommand {
  constructor(app, group, children) {
    this.app = app;
    this.group = group;
    this.children = children;
    this.label = 'Ungroup';
  }
  execute() {
    this.group.unmount();
    this.app.shapes.delete(this.group.id);
    this.app.layers.removeShapeFromLayer(this.group.id, this.group.layerId);
    this.children.forEach(s => {
      this.app.shapes.set(s.id, s);
      this.app.layers.addShapeToLayer(s.id, s.layerId);
      s.mount(this.app.canvas.shapesLayer);
    });
    this.app.bus.emit(Events.SHAPE_ADDED, { shapes: this.children });
  }
  undo() {
    this.children.forEach(s => {
      s.unmount();
      this.app.shapes.delete(s.id);
      this.app.layers.removeShapeFromLayer(s.id, s.layerId);
    });
    this.app.shapes.set(this.group.id, this.group);
    this.app.layers.addShapeToLayer(this.group.id, this.group.layerId);
    this.group.mount(this.app.canvas.shapesLayer);
    this.app.bus.emit(Events.SHAPE_UPDATED, {});
  }
}
