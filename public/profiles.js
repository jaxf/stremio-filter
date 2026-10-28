// Conservative starting points, not a hardware certification database.
const base = { maxResolution: 1080, codecs: ['h264'], audio: ['aac', 'ac3', 'eac3', 'mp3'], hdr: false, dv: false, browser: false };
const profile = (id, name, family, note, extra = {}) => ({ ...base, id, name, family, note, ...extra });
export const PROFILES = [
  profile('safe', 'Universal / older device', 'other', '1080p H.264, SDR. A conservative starting point for unlisted devices.'),
  profile('mac', 'MacBook / Mac', 'mac', 'For a desktop player that supports HEVC and MKV. Browser playback has its own profile.', { codecs: ['h264', 'hevc'], maxResolution: 2160 }),
  profile('ios', 'iPhone / iPad', 'ios', 'For an external player such as VLC or Infuse. Choose Browser for in-browser playback.', { codecs: ['h264', 'hevc'] }),
  profile('apple-tv', 'Apple TV', 'apple', 'For a compatible player such as Infuse. Display HDR support must be enabled separately.', { codecs: ['h264', 'hevc'], maxResolution: 2160 }),
  profile('google-tv', 'Google TV / Android TV', 'google', 'Conservative 1080p preset. Select the 4K preset only for a 4K-capable model.', { codecs: ['h264', 'hevc'] }),
  profile('google-tv-4k', 'Google TV · 4K', 'google', 'HEVC and 4K enabled; HDR and Dolby Vision remain opt-in.', { codecs: ['h264', 'hevc'], maxResolution: 2160 }),
  profile('fire-tv', 'Fire TV Stick', 'fire', 'Conservative preset for an unknown Fire TV Stick generation.'),
  profile('fire-tv-4k', 'Fire TV Stick · 4K / Max', 'fire', 'HEVC and 4K enabled. AV1 and Dolby Vision depend on generation.', { codecs: ['h264', 'hevc'], maxResolution: 2160 }),
  profile('android', 'Android phone / tablet', 'android', '1080p HEVC for a compatible native player.', { codecs: ['h264', 'hevc'] }),
  profile('windows', 'Windows desktop', 'windows', 'For Stremio desktop or another full media player.', { codecs: ['h264', 'hevc'], maxResolution: 2160 }),
  profile('linux', 'Linux desktop', 'linux', 'For a full media player with the required decoders installed.', { codecs: ['h264', 'hevc'], maxResolution: 2160 }),
  profile('samsung', 'Samsung TV', 'samsung', 'Model-dependent. Starts at 1080p SDR with no DTS or TrueHD.'),
  profile('lg', 'LG TV', 'lg', 'Model-dependent. Starts at 1080p SDR with no DTS or TrueHD.'),
  profile('browser', 'Web browser', 'browser', 'H.264 + AAC/MP3 in MP4, or HLS. MKV and non-web-ready sources are excluded.', { audio: ['aac', 'mp3'], browser: true }),
];
export const DEFAULT_DEVICES = [
  { profile: 'mac', label: 'MacBook' },
  { profile: 'ios', label: 'iPhone / iPad' },
  { profile: 'google-tv', label: 'Google TV' },
  { profile: 'fire-tv', label: 'Fire TV' },
];
export function capabilities(device) {
  const p = PROFILES.find(p => p.id === device.profile);
  if (!p) throw new Error('Unknown device profile');
  return { ...p, maxResolution: device.maxResolution ?? p.maxResolution,
    codecs: device.codecs ?? p.codecs, audio: device.audio ?? p.audio,
    hdr: device.hdr ?? p.hdr, dv: device.dv ?? p.dv };
}
