import type { ClickMapEvent, ClickMapEventType } from "../../shared/types.js";

type Listener<T extends ClickMapEvent> = (event: T) => void;

export class Emitter {
  private m = new Map<string, Set<Listener<ClickMapEvent>>>();

  on<T extends ClickMapEventType>(
    type: T,
    cb: Listener<Extract<ClickMapEvent, { type: T }>>
  ): void {
    let s = this.m.get(type);
    if (!s) {
      s = new Set();
      this.m.set(type, s);
    }
    s.add(cb as Listener<ClickMapEvent>);
  }

  off<T extends ClickMapEventType>(
    type: T,
    cb: Listener<Extract<ClickMapEvent, { type: T }>>
  ): void {
    this.m.get(type)?.delete(cb as Listener<ClickMapEvent>);
  }

  emit(event: ClickMapEvent): void {
    this.m.get(event.type)?.forEach((cb) => cb(event));
  }
}
