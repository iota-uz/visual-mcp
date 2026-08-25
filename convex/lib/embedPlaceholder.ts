// Static, canvas-independent 64×64 unavailable-preview icon. Keeping it
// in code makes the transient-failure path independent of storage and worker health.
const BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAgVBMVEVMaXHy9Pbz9PXz9PXy9Pbz9PXy9Pby8/X////y9Pby9PXy9Pby9Pbz8/P////////z8/Py8vjy8/Xy9Pbz8/Xz8/Py9PXz9PXy9PXy9PXz9Pbz8/by9PXz9PZrcoBtdIJtdIHFyM7Gyc/CxcvCxszGys95f4x6gIzHytDLzdPIytGzNCaFAAAAHXRSTlMAkNXy0/OO/AaRjdSTLAcFKyr9lPQtvPG9vpaXu2C96qQAAAAJcEhZcwAACxMAAAsTAQCanBgAAAEnSURBVFjD7ZfZEoIwDEWjgoAbiPvSVkVB/f8PlFZ0FIeGNuOLct/amXvaNCFMAHLNgv6UGWrabw3hrtE6ZlbyJr7yr5i1lpKwYQQN8vhjCsCLIGAkdaFNAzjg0gAdYEQ1gAbwy4BLmp7Le9c0vdQGZJyL/fvWXnCemQBKBOk3AJxFiaD84lr/EU/SsEsey4NaHk2y8EbQ+SvT+ELQ+qvr4EnQ+zWFVBAQv64S708v+GdR1C1ldQf9+ci3oO6gPR8BqPhf6sEUcHiEkNgBqI9Y5K9U1fUBz/wjBMD8GAFQP0IA3K8nfKehkFsauamS23rzb2wA/wjo0PwL+sjTogF6MPRIY98YYEIBBPnk6s/t/dtQDs/+wDIKLwiL+T3qOsbjo+v0xtJ7A9sIzCjpuDM5AAAAAElFTkSuQmCC";

export function embedPlaceholderPng(): ArrayBuffer {
  const binary = atob(BASE64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
