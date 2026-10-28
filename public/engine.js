import { capabilities } from './profiles.js';

export function parseStream(stream) {
  const filename = String(stream.behaviorHints?.filename || '');
  const text = [filename, stream.name, stream.title, stream.description].filter(Boolean).join(' ').toLowerCase();
  const res = text.match(/\b(2160|1440|1080|720|576|480)[pi]\b/);
  const resolution = res ? Number(res[1]) : /\b4k\b/.test(text) ? 2160 : null;
  const codecs = [];
  if (/\b(?:x[ ._-]?265|h[ ._-]?265|hevc)\b/.test(text)) codecs.push('hevc');
  if (/\b(?:x[ ._-]?264|h[ ._-]?264|avc)\b/.test(text)) codecs.push('h264');
  if (/\bav1\b/.test(text)) codecs.push('av1');
  if (/\bvp9\b/.test(text)) codecs.push('vp9');
  if (/\b(?:xvid|divx|mpeg[ ._-]?2)\b/.test(text)) codecs.push('legacy');
  const audio = [];
  if (/\baac(?:[ ._-]?\d)?\b/.test(text)) audio.push('aac');
  if (/\b(?:e[ ._-]?ac[ ._-]?3|ddp)(?:\d|\b)|dd\+/.test(text)) audio.push('eac3');
  if (/\b(?:ac[ ._-]?3|dd)(?:\d|\b)/.test(text.replace(/e[ ._-]?ac[ ._-]?3/g, '').replace(/dd\+/g, ''))) audio.push('ac3');
  if (/\bdts(?:[ ._-]?hd)?\b/.test(text)) audio.push('dts');
  if (/\btrue[ ._-]?hd\b/.test(text)) audio.push('truehd');
  if (/\bflac\b/.test(text)) audio.push('flac');
  if (/\bopus\b/.test(text)) audio.push('opus');
  if (/\bmp3\b/.test(text)) audio.push('mp3');
  const dv = /\b(?:dv|dovi|dolby[ ._-]?vision)\b/.test(text);
  const hdr = /\b(?:hdr(?:10\+?)?|hlg)\b/.test(text);
  const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*(gib|gb|mib|mb)\b/);
  const hintedSize = Number(stream.behaviorHints?.videoSize);
  const bytes = hintedSize > 0 ? hintedSize : sizeMatch ? Number(sizeMatch[1]) * ({gib:2**30,gb:1e9,mib:2**20,mb:1e6}[sizeMatch[2]]) : null;
  const uncached = /\b(?:uncached|not[ ._-]?cached|download(?:ing)?|queued)\b|\[(?:rd|ad|tb|pm)[ -]?download\]/.test(text);
  const cached = !uncached && /\b(?:cached|instant)\b|\[(?:rd|ad|tb|pm|ed|dl)\+\]|⚡/.test(text);
  let container = filename.match(/\.(mkv|mp4|m4v|webm|avi|m3u8)(?:\b|$)/i)?.[1]?.toLowerCase();
  if (!container && typeof stream.url === 'string') {
    try { container = new URL(stream.url).pathname.match(/\.(mkv|mp4|m4v|webm|avi|m3u8)$/i)?.[1]?.toLowerCase(); } catch {}
  }
  return { filename, resolution, codecs, audio, dv, hdr, bytes, container, cached, uncached,
    lowQuality: /\b(?:cam|hdcam|telesync|hdts|telecine|screener)\b/.test(text) };
}

export function assess(stream, device, settings) {
  const c = capabilities(device), m = parseStream(stream), reasons = [];
  const direct = typeof stream.url === 'string' && /^https?:\/\//i.test(stream.url);
  const torrent = typeof stream.infoHash === 'string' && /^[a-f0-9]{40}$/i.test(stream.infoHash);
  if (!direct && !(torrent && settings.allowP2P && !c.browser)) reasons.push('Source type');
  if (m.resolution && m.resolution > c.maxResolution) reasons.push('Resolution');
  if (m.codecs.some(v => !c.codecs.includes(v))) reasons.push('Video codec');
  if (m.audio.some(v => !c.audio.includes(v))) reasons.push('Audio format');
  if (m.dv && !c.dv) reasons.push('Dolby Vision');
  if (m.hdr && !c.hdr) reasons.push('HDR');
  if (m.lowQuality) reasons.push('Camera / screener');
  if (settings.hideUncached && m.uncached) reasons.push('Not cached');
  if (settings.cachedOnly && !m.cached) reasons.push('Cache status unconfirmed');
  if (m.bytes && m.bytes > settings.maxSizeGB * 1e9) reasons.push('File size');
  if (c.browser && (stream.behaviorHints?.notWebReady || stream.behaviorHints?.proxyHeaders || (m.container && !['mp4','m4v','m3u8'].includes(m.container)))) reasons.push('Browser playback');
  // SDR is only an inference when a release has no HDR/DV tag; it is not probed.
  const incomplete = !m.resolution || !m.codecs.length || !m.audio.length || (c.browser && !m.container);
  if (settings.unknown === 'exclude' && incomplete) reasons.push('Missing details');
  let score = (m.cached ? 500 : 0) + (incomplete ? -1000 : 0) + (m.resolution || 0) / 10;
  if (settings.priority === 'smaller') score = (m.cached ? 500 : 0) + (incomplete ? -1000 : 0) - (m.bytes ? m.bytes / 1e8 : 500);
  return { eligible: reasons.length === 0, reasons, meta: m, incomplete, score };
}

// Only use distinctive evidence. Generic Android/Stremio headers do not identify a TV.
export function detectedDevices(devices, userAgent = '') {
  const ua = userAgent.toLowerCase();
  let family = null;
  if (/\b(?:aft[a-z0-9]+|fire[ -]?tv)\b/.test(ua)) family = 'fire';
  else if (/iphone|ipad|ipod/.test(ua)) family = 'ios';
  else if (/apple[ -]?tv|tvos/.test(ua)) family = 'apple';
  else if (/google[ -]?tv|chromecast/.test(ua)) family = 'google';
  else if (/tizen/.test(ua)) family = 'samsung';
  else if (/webos|web0s/.test(ua)) family = 'lg';
  // Player identity matters. Browser-vs-native and multiple same-family devices are ambiguous.
  const browser = /safari|chrome|firefox|edg\//.test(ua) && !/stremio/.test(ua);
  const matches = devices.filter(d => capabilities(d).family === family);
  return family && matches.length === 1 && !browser ? matches : devices;
}

function keyOf(stream) {
  if (stream.infoHash) return `${stream.infoHash.toLowerCase()}:${stream.fileIdx ?? 'largest'}`;
  return `${stream.url}|${JSON.stringify(stream.behaviorHints?.proxyHeaders || {})}`;
}

export function selectStreams(entries, config, userAgent = '') {
  const settings = config.settings;
  const devices = settings.mode === 'auto' ? detectedDevices(config.devices, userAgent) : config.devices;
  const unique = [...new Map(entries.map(e => [keyOf(e.stream), e])).values()];
  const groups = settings.mode === 'universal' ? [{ label: 'Everyone', devices }] : devices.map(d => ({label:d.label, devices:[d]}));
  const output = [], report = [];
  for (const group of groups) {
    const assessed = unique.map(e => {
      const checks = group.devices.map(d => assess(e.stream, d, settings));
      return { ...e, ...checks[0], eligible: checks.every(c => c.eligible), incomplete: checks.some(c => c.incomplete), score: Math.min(...checks.map(c => c.score)) };
    });
    const eligible = assessed.filter(e => e.eligible).sort((a,b) => b.score-a.score);
    // Incomplete metadata is a fallback only, so it never crowds out known matches.
    const known = eligible.filter(e => !e.incomplete);
    const chosen = (settings.unknown === 'fallback' && known.length ? known : eligible).slice(0, settings.limit);
    report.push({ label:group.label, total:unique.length, eligible:eligible.length, shown:chosen.length });
    chosen.forEach((e, i) => {
      const quality = e.meta.resolution ? `${e.meta.resolution}p` : 'Quality unknown';
      const size = e.meta.bytes ? `${(e.meta.bytes / 1e9).toFixed(1)} GB` : 'Size unknown';
      const status = e.incomplete ? 'Details incomplete' : i === 0 ? 'Top match' : 'Alternative';
      const details = [e.provider, e.meta.codecs.join('/')?.toUpperCase() || 'Codec unknown', size,
        e.meta.cached ? 'Reported cached' : 'Cache unconfirmed', e.meta.dv ? 'Dolby Vision' : e.meta.hdr ? 'HDR' : 'No HDR tag'].join(' · ');
      output.push({ ...e.stream, name: `${group.label}\n${quality} · ${status}`,
        behaviorHints: { ...e.stream.behaviorHints, ...(e.stream.behaviorHints?.bingeGroup ? {bingeGroup:`family-${group.devices.map(d=>d.profile).join('-')}-${e.stream.behaviorHints.bingeGroup}`} : {}) },
        description: `${details}\n${e.meta.filename || 'Compatibility estimated from source labels.'}`,
        title: `${details}\n${e.meta.filename || 'Compatibility estimated from source labels.'}` });
    });
  }
  return { streams: output, report };
}
