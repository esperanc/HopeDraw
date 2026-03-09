/** Centralized event name constants for EventBus */
export const Events = {
  // Shapes
  SHAPE_ADDED:    'shape:added',
  SHAPE_REMOVED:  'shape:removed',
  SHAPE_UPDATED:  'shape:updated',
  SHAPES_REORDERED: 'shapes:reordered',

  // Selection
  SELECTION_CHANGED: 'selection:changed',

  // Layers
  LAYER_ADDED:    'layer:added',
  LAYER_REMOVED:  'layer:removed',
  LAYER_UPDATED:  'layer:updated',
  LAYER_REORDERED:'layer:reordered',

  // Project
  PROJECT_NEW:    'project:new',
  PROJECT_LOADED: 'project:loaded',
  PROJECT_SAVED:  'project:saved',
  PROJECT_CHANGED:'project:changed',

  // History
  HISTORY_CHANGED:'history:changed',

  // Tools
  TOOL_CHANGED:   'tool:changed',

  // Canvas
  ZOOM_CHANGED:   'zoom:changed',
  GRID_TOGGLED:   'grid:toggled',
  SNAP_CHANGED:   'snap:changed',

  // UI
  MODAL_OPEN:     'modal:open',
  MODAL_CLOSE:    'modal:close',
  PROPERTIES_REFRESH: 'properties:refresh',
};
