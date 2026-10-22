/** Public settings only. Never add your access key, phone, OTP or cookies here. */
export const CONFIG = Object.freeze({
  // Empty: same server hosts website and API (recommended).
  // With GitHub Pages: set this to the HTTPS origin of your Node/Playwright server.
  apiBase: '',
  tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  center: [45.4642, 9.1900], zoom: 13
});
