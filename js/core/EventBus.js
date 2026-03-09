/** Lightweight publish/subscribe event bus */
export class EventBus {
  constructor() {
    this._handlers = {};
  }

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    return () => this.off(event, fn); // returns unsubscribe fn
  }

  off(event, fn) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(h => h !== fn);
  }

  emit(event, data) {
    (this._handlers[event] || []).forEach(fn => {
      try { fn(data); } catch(e) { console.error(`EventBus error in "${event}":`, e); }
    });
  }

  once(event, fn) {
    const wrapper = (data) => { fn(data); this.off(event, wrapper); };
    this.on(event, wrapper);
  }
}
