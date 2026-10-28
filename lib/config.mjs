import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PROFILES } from '../public/profiles.js';
export const DEFAULT_SETTINGS = { mode:'auto', limit:3, maxSizeGB:20, priority:'quality', unknown:'fallback', hideUncached:true, cachedOnly:false, allowP2P:false };
export function addonURL(value) {
  if (typeof value !== 'string' || value.length > 1800) throw new Error('Enter a valid addon manifest URL (maximum 1,800 characters).');
  let url;
  try { url = new URL(value.trim().replace(/^stremio:\/\//i, 'https://')); } catch { throw new Error('Enter a valid HTTPS manifest URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || !url.pathname.endsWith('/manifest.json')) throw new Error('Sources must be HTTPS URLs ending in /manifest.json, without a fragment or HTTP password.');
  return url.toString();
}
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001f<>]/.test(value);
export function validateConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid configuration.');
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 6) throw new Error('Add between one and six source addons.');
  if (!Array.isArray(input.devices) || input.devices.length < 1 || input.devices.length > 8) throw new Error('Choose between one and eight devices.');
  const sources = input.sources.map(s => {
    if (!s || !text(s.name, 32)) throw new Error('Each source needs a name of up to 32 characters.');
    return {name:s.name.trim(), url:addonURL(s.url)};
  });
  const devices = input.devices.map(d => {
    if (!d || !PROFILES.some(p => p.id === d.profile) || !text(d.label, 40)) throw new Error('Each device needs a valid profile and a label of up to 40 characters.');
    const result = {profile:d.profile, label:d.label.trim()};
    if (d.maxResolution !== undefined) {
      if (![720,1080,2160].includes(d.maxResolution)) throw new Error('Invalid resolution limit.');
      result.maxResolution = d.maxResolution;
    }
    for (const [field, values] of Object.entries({codecs:['h264','hevc','av1','vp9'], audio:['aac','ac3','eac3','mp3','dts','truehd','flac','opus']})) {
      if (d[field] !== undefined) {
        if (!Array.isArray(d[field]) || !d[field].length || d[field].length > values.length || d[field].some(x => !values.includes(x))) throw new Error('Invalid device format selection.');
        result[field] = [...new Set(d[field])];
      }
    }
    for (const field of ['hdr','dv']) if (d[field] !== undefined) {
      if (typeof d[field] !== 'boolean') throw new Error('Invalid HDR setting.');
      result[field] = d[field];
    }
    return result;
  });
  if (new Set(devices.map(d=>d.label)).size !== devices.length) throw new Error('Give each device a different label.');
  const settings = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(settings)) if (input.settings?.[k] !== undefined) settings[k] = input.settings[k];
  if (!['auto','groups','universal'].includes(settings.mode) || !['quality','smaller'].includes(settings.priority) || !['fallback','exclude'].includes(settings.unknown)) throw new Error('Invalid filter setting.');
  if (!Number.isInteger(settings.limit) || settings.limit < 1 || settings.limit > 5 || !Number.isFinite(settings.maxSizeGB) || settings.maxSizeGB < 1 || settings.maxSizeGB > 200) throw new Error('Invalid result or file-size limit.');
  for (const field of ['hideUncached','cachedOnly','allowP2P']) if (typeof settings[field] !== 'boolean') throw new Error('Invalid source setting.');
  const config = {version:1, sources, devices, settings};
  if (Buffer.byteLength(JSON.stringify(config)) > 5200) throw new Error('Configuration is too large. Use fewer or shorter source URLs.');
  return config;
}
function key(secret) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.startsWith('replace-')) throw new Error('Set CONFIG_SECRET to at least 32 random characters on the server.');
  return createHash('sha256').update(secret).digest();
}
export function seal(config, secret) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from([1]), deflateRawSync(Buffer.from(JSON.stringify(config)))])), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
export function unseal(token, secret) {
  if (!/^[A-Za-z0-9_-]{40,7100}$/.test(token)) throw new Error('Invalid install link.');
  try {
    const bytes = Buffer.from(token,'base64url'), decipher = createDecipheriv('aes-256-gcm', key(secret), bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    const payload = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    const plain = payload[0] === 1 ? inflateRawSync(payload.subarray(1), { maxOutputLength: 5200 }) : payload;
    return validateConfig(JSON.parse(plain.toString('utf8')));
  } catch { throw new Error('This install link is invalid or its server key has changed. Create a new link.'); }
}
export function manifest(config) {
  const id = createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0,16);
  return { id:`community.familyfilter.${id}`, version:'1.0.0', name:'Family Streams',
    description:`One shared addon · ${config.devices.map(d=>d.label).join(', ')}`,
    resources:[{name:'stream',types:['movie','series'],idPrefixes:['tt']}], types:['movie','series'], catalogs:[],
    behaviorHints:{configurable:false} };
}
