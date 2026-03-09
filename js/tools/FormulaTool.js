import { AddShapeCommand } from '../core/CommandManager.js';
import { FormulaShape } from '../shapes/FormulaShape.js';

/** Formula tool – click to place a formula, then open the editor */
export class FormulaTool {
  constructor(app) {
    this.app = app;
    this.cursor = 'crosshair';
  }

  activate() { this.app.canvas.svg.style.cursor = this.cursor; }
  deactivate() {}

  onPointerDown(wx, wy, e) {
    if (e.button !== 0) return;
    const d = this.app.getDefaultProps('formula');
    const shape = new FormulaShape({
      x: wx - 60, y: wy - 30, width: 120, height: 60,
      latex: '\\frac{1}{2}x^2',
      layerId: this.app.layers.getActiveLayer()?.id,
      ...d
    });
    this.app.commands.execute(new AddShapeCommand(this.app, shape));
    this.app.selection.select(shape.id);
    this.app.setActiveTool('select');
    // Open editor immediately
    setTimeout(() => this.app.openFormulaEditor(shape), 50);
  }

  onPointerMove() {}
  onPointerUp() {}
}
