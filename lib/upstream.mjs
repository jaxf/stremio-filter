import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { addonURL } from './config.mjs';

const blocked = new BlockList();
for (const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip,prefix,'ipv4');
const v6Global = new BlockList(); v6Global.addSubnet('2000::',3,'ipv6');
for (const [ip,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) blocked.addSubnet(ip,prefix,'ipv6');
export function publicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address,'ipv4');
  if (family === 6) return v6Global.check(address,'ipv6') && !blocked.check(address,'ipv6');
  return false;
}
export function streamURL(source, type, id) {
  const u = new URL(addonURL(source));
  u.pathname = `${u.pathname.slice(0,-'manifest.json'.length)}stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  return u;
}
export async function fetchJSON(target, { timeout = 7500, allowedHosts = process.env.ALLOWED_ADDON_HOSTS, resolve = lookup } = {}) {
  const u = new URL(target);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new Error('Unsupported source URL');
  const host = u.hostname.replace(/^\[|\]$/g,'');
  if (allowedHosts && !allowedHosts.split(',').map(x=>x.trim().toLowerCase()).includes(host.toLowerCase())) throw new Error('Source host is not allowed');
  // Deadline includes DNS and body consumption. Pin the checked address to defeat DNS rebinding.
  let request;
  let timer;
  const operation = async () => {
    const addresses = isIP(host) ? [{address:host, family:isIP(host)}] : await resolve(host,{all:true});
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Source must use a public IP address');
    const chosen = addresses.find(a => a.family === 4) || addresses[0];
    return new Promise((resolveResult,reject) => {
      request = https.get(u, {agent:false, headers:{Accept:'application/json','User-Agent':'FamilyStreams/1.0'},
        lookup:(_hostname, options, callback) => options.all ? callback(null,[chosen]) : callback(null,chosen.address,chosen.family)
      }, response => {
        // No redirects: never send configured credentials to another destination.
        if (response.statusCode !== 200) {response.resume(); reject(new Error(`Source returned HTTP ${response.statusCode}`)); return;}
        const chunks = []; let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 2_000_000) { request.destroy(new Error('Source response too large')); return; }
          chunks.push(chunk);
        });
        response.on('error',reject);
        response.on('end',()=> {try {resolveResult(JSON.parse(Buffer.concat(chunks).toString('utf8')));} catch {reject(new Error('Source did not return JSON'));}});
      });
      request.on('error',reject);
    });
  };
  // Do not start an HTTPS request if DNS finishes after the deadline.
  let expired = false;
  const guardedResolve = resolve;
  resolve = async (...args) => { const records = await guardedResolve(...args); if (expired) throw new Error('Source timed out'); return records; };
  try {
    return await Promise.race([operation(), new Promise((_, reject)=>{timer=setTimeout(()=>{expired=true; request?.destroy(); reject(new Error('Source timed out'));},timeout);})]);
  } finally { clearTimeout(timer); }
}
export async function aggregate(config, type, id, fetcher = fetchJSON) {
  const statuses = await Promise.all(config.sources.map(async source => {
    try {
      const result = await fetcher(streamURL(source.url,type,id));
      if (!Array.isArray(result.streams)) throw new Error('Invalid source response');
      const entries = result.streams.slice(0,500).filter(s => s && typeof s === 'object').map(stream=>({stream,provider:source.name}));
      return {name:source.name, entries, ok:true};
    } catch (error) {
      const message = /^Source (?:returned HTTP \d{3}|timed out|response too large|did not return JSON|must use a public IP address|host is not allowed)$/.test(error.message) ? error.message : error.message === 'Invalid source response' ? 'Response has no stream list' : 'Connection or DNS failed';
      return {name:source.name, entries:[], ok:false, message};
    }
  }));
  return {entries:statuses.flatMap(s=>s.entries), failures:statuses.filter(s=>!s.ok).map(s=>s.name), sources:statuses.map(s=>({name:s.name,ok:s.ok,count:s.entries.length,message:s.message || (s.entries.length ? 'Streams received' : 'Source returned no streams')}))};
}
