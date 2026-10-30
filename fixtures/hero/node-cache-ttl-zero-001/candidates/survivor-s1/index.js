class Cache {
  constructor() { this.entries = new Map(); }
  set(key, value, ttl = 0) { this.entries.set(key, {value, expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : 0}); return true; }
  ttl(key, ttl = 0) {
    const entry = this.entries.get(key);
    if (!entry || (entry.expiresAt !== 0 && entry.expiresAt < Date.now())) { this.entries.delete(key); return false; }
    if (ttl < 0) this.entries.delete(key);
    else if (ttl > 0) entry.expiresAt = Date.now() + ttl * 1000;
    return true;
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== 0 && entry.expiresAt < Date.now()) { this.entries.delete(key); return undefined; }
    return entry.value;
  }
  getTtl(key) { const entry = this.entries.get(key); return entry ? entry.expiresAt : undefined; }
  close() {}
}
module.exports = Cache;