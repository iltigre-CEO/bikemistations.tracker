/** Small dependency-free Web Mercator map. Only visible OSM tiles are requested. */
const SIZE = 256;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function project(lat, lon, zoom) {
  const scale = SIZE * 2 ** zoom;
  const sin = Math.sin(clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180);
  return [((lon + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}
export function unproject(x, y, zoom) {
  const scale = SIZE * 2 ** zoom;
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI, x / scale * 360 - 180];
}
export class InteractiveMap {
  constructor(element, options = {}) {
    this.el = element; this.center = options.center ?? [45.4642, 9.19]; this.zoom = options.zoom ?? 13;
    this.tileUrl = options.tiles; this.onSelect = options.onSelect ?? (() => {});
    this.onMove = options.onMove ?? (() => {}); this.onTileError = options.onTileError ?? (() => {});
    this.stations = []; this.visited = new Set(); this.tiles = new Map(); this.pointers = new Map(); this.clustering = true;
    this.tilesEl = document.createElement('div'); this.tilesEl.className = 'map-tiles';
    this.markersEl = document.createElement('div'); this.markersEl.className = 'map-markers';
    this.locationEl = document.createElement('div'); this.locationEl.className = 'map-user-layer';
    this.el.append(this.tilesEl, this.markersEl, this.locationEl);
    this.bind(); this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(element);
    this.draw();
  }
  bind() {
    this.el.addEventListener('pointerdown', e => {
      if (e.target.closest('button, a, input')) return;
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      this.el.setPointerCapture(e.pointerId);
      this.dragCenter = project(...this.center, this.zoom);
      this.dragOrigin = [e.clientX, e.clientY];
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDistance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.pinchZoom = this.zoom;
      }
    });
    this.el.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pointers.size === 1) {
        this.center = unproject(this.dragCenter[0] - e.clientX + this.dragOrigin[0], this.dragCenter[1] - e.clientY + this.dragOrigin[1], this.zoom);
        this.center[0] = clamp(this.center[0], -85, 85);
        this.center[1] = ((this.center[1] + 180) % 360 + 360) % 360 - 180;
        this.onMove(); this.draw();
      } else if (this.pointers.size === 2 && this.pinchDistance) {
        const [a, b] = [...this.pointers.values()];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const next = clamp(Math.round(this.pinchZoom + Math.log2(distance / this.pinchDistance)), 3, 19);
        const rect = this.el.getBoundingClientRect();
        if (next !== this.zoom) this.zoomAt(next, [(a[0] + b[0]) / 2 - rect.left, (a[1] + b[1]) / 2 - rect.top]);
      }
    });
    const end = e => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 1) {
        this.dragOrigin = [...this.pointers.values()][0]; this.dragCenter = project(...this.center, this.zoom);
      }
      if (this.pointers.size < 2) this.pinchDistance = null;
    };
    this.el.addEventListener('pointerup', end); this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('wheel', e => {
      e.preventDefault(); if (Date.now() - (this.lastWheel || 0) < 160) return;
      this.lastWheel = Date.now(); const r = this.el.getBoundingClientRect();
      this.zoomAt(this.zoom + (e.deltaY < 0 ? 1 : -1), [e.clientX - r.left, e.clientY - r.top]);
    }, { passive: false });
    this.el.addEventListener('keydown', e => {
      const moves = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] };
      if (moves[e.key]) {
        e.preventDefault(); const p = project(...this.center, this.zoom), d = moves[e.key];
        this.setView(unproject(p[0] + d[0], p[1] + d[1], this.zoom), this.zoom); this.onMove();
      } else if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); this.zoomAt(this.zoom + (e.key === '-' ? -1 : 1)); }
    });
  }
  zoomAt(zoom, point) {
    const next = clamp(zoom, 3, 19); if (next === this.zoom) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const anchor = point ?? [w / 2, h / 2], c = project(...this.center, this.zoom);
    const offset = [anchor[0] - w / 2, anchor[1] - h / 2];
    const geographical = unproject(c[0] + offset[0], c[1] + offset[1], this.zoom);
    const p = project(...geographical, next);
    this.center = unproject(p[0] - offset[0], p[1] - offset[1], next); this.zoom = next;
    this.onMove(); this.draw();
  }
  setView(center, zoom = this.zoom) {
    if (!center.every(Number.isFinite)) return;
    this.center = [clamp(center[0], -85, 85), center[1]]; this.zoom = clamp(Math.round(zoom), 3, 19); this.draw();
  }
  setStations(stations, visited, labels = {}) { this.stations = stations; this.visited = new Set(visited); this.labels = labels; this.draw(); }
  setLocation(location) { this.location = location; this.draw(); }
  setSelected(id) { this.selected = id; this.draw(); }
  draw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
  }
  render() {
    const width = this.el.clientWidth, height = this.el.clientHeight;
    if (!width || !height) return;
    const center = project(...this.center, this.zoom), origin = [center[0] - width / 2, center[1] - height / 2];
    const zoom = this.zoom, max = 2 ** zoom;
    const needed = new Set();
    for (let x = Math.floor(origin[0] / SIZE); x <= Math.floor((origin[0] + width) / SIZE); x++) {
      for (let y = Math.floor(origin[1] / SIZE); y <= Math.floor((origin[1] + height) / SIZE); y++) {
        if (y < 0 || y >= max) continue;
        const wrappedX = ((x % max) + max) % max, key = `${zoom}/${x}/${y}`;
        needed.add(key); let tile = this.tiles.get(key);
        if (!tile) {
          tile = new Image(); tile.alt = ''; tile.draggable = false; tile.className = 'map-tile'; tile.width = SIZE; tile.height = SIZE;
          tile.decoding = 'async'; tile.referrerPolicy = 'strict-origin-when-cross-origin';
          tile.onerror = () => { tile.style.visibility = 'hidden'; if (!this.tileErrorReported) { this.tileErrorReported = true; this.onTileError(); } };
          tile.src = this.tileUrl.replace('{z}', zoom).replace('{x}', wrappedX).replace('{y}', y);
          this.tiles.set(key, tile); this.tilesEl.append(tile);
        }
        tile.style.transform = `translate(${Math.round(x * SIZE - origin[0])}px,${Math.round(y * SIZE - origin[1])}px)`;
      }
    }
    for (const [key, tile] of this.tiles) if (!needed.has(key)) { tile.remove(); this.tiles.delete(key); }
    const groups = new Map(), useCluster = this.clustering && zoom < 15;
    for (const station of this.stations) {
      const p = project(station.latitude, station.longitude, zoom), x = p[0] - origin[0], y = p[1] - origin[1];
      if (x < -50 || y < -50 || x > width + 50 || y > height + 50) continue;
      const key = useCluster ? `${Math.floor(p[0] / 58)},${Math.floor(p[1] / 58)}` : station.stationId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ station, x, y });
    }
    const fragment = document.createDocumentFragment();
    for (const group of groups.values()) {
      const btn = document.createElement('button'); btn.type = 'button';
      const x = group.reduce((a, p) => a + p.x, 0) / group.length, y = group.reduce((a, p) => a + p.y, 0) / group.length;
      btn.style.left = `${x}px`; btn.style.top = `${y}px`;
      if (group.length > 1) {
        const count = group.filter(p => this.visited.has(p.station.stationId)).length;
        btn.className = 'map-marker cluster'; btn.style.setProperty('--completed', `${count / group.length * 100}%`);
        const number = document.createElement('span'); number.textContent = String(group.length); btn.append(number);
        btn.setAttribute('aria-label', `${group.length} ${this.labels.stations || 'stazioni'}, ${count} ${this.labels.visited || 'visitate'}`);
        btn.title = btn.getAttribute('aria-label');
        btn.addEventListener('click', () => { this.onMove(); this.setView(unproject(origin[0] + x, origin[1] + y, zoom), zoom + 2); });
      } else {
        const station = group[0].station, visited = this.visited.has(station.stationId);
        btn.className = `map-marker station ${visited ? 'is-visited' : 'is-missing'} ${station.stationId === this.selected ? 'is-selected' : ''}`;
        btn.textContent = visited ? '\u2713' : (station.name.match(/^([A-Za-z]?\d+)\s*-/)?.[1] ?? '\u00b7');
        btn.setAttribute('aria-label', `${station.name} - ${visited ? this.labels.visited : this.labels.missing}`);
        btn.title = btn.getAttribute('aria-label'); btn.dataset.stationId = station.stationId;
        btn.addEventListener('click', () => this.onSelect(station));
      }
      fragment.append(btn);
    }
    this.markersEl.replaceChildren(fragment); this.locationEl.replaceChildren();
    if (this.location) {
      const p = project(this.location.latitude, this.location.longitude, zoom), x = p[0] - origin[0], y = p[1] - origin[1];
      if (x > -500 && x < width + 500 && y > -500 && y < height + 500) {
        const metersPerPixel = 156543.03392 * Math.cos(this.location.latitude * Math.PI / 180) / 2 ** zoom;
        const radius = clamp(this.location.accuracy / metersPerPixel, 8, 2000);
        const accuracy = document.createElement('div'); accuracy.className = 'accuracy-circle';
        Object.assign(accuracy.style, { left: `${x}px`, top: `${y}px`, width: `${radius * 2}px`, height: `${radius * 2}px` });
        const dot = document.createElement('div'); dot.className = 'user-dot'; dot.style.left = `${x}px`; dot.style.top = `${y}px`;
        this.locationEl.append(accuracy, dot);
      }
    }
  }
}
