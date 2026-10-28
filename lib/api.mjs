import { validateConfig, seal, unseal, manifest } from './config.mjs';
import { aggregate, fetchJSON } from './upstream.mjs';
import { selectStreams } from '../public/engine.js';

const headers = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store','Vary':'User-Agent','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const reply = (status, data) => ({status,headers,body:JSON.stringify(data)});
const limits = new Map();
function allowed(client) {
  const now = Date.now();
  for (const [k,v] of limits) if (v.until < now) limits.delete(k);
  if (limits.size > 5000) return false;
  const state = limits.get(client) || {until:now+60_000,count:0};
  state.count++; limits.set(client,state);
  return state.count <= 60;
}
export async function handle({method='GET',path='/',body='',userAgent='',client='unknown'}, {secret=process.env.CONFIG_SECRET,fetcher=fetchJSON}={}) {
  if (method === 'OPTIONS') return reply(204,null);
  if (path === '/api/health' && method === 'GET') return reply(200,{ok:true,configured:Boolean(secret && secret.length>=32 && !secret.startsWith('replace-'))});
  if (!allowed(client)) return reply(429,{error:'Too many requests. Try again in one minute.'});
  if (!secret || secret.length < 32 || secret.startsWith('replace-')) return reply(503,{error:'Set CONFIG_SECRET in the server environment before creating install links.'});
  try {
    if (path === '/api/config' || path === '/api/check' || path === '/api/diagnose') {
      if (method !== 'POST') return reply(405,{error:'Use POST.'});
      if (Buffer.byteLength(body) > 16_000) return reply(413,{error:'Configuration too large.'});
      let input; try {input=JSON.parse(body);} catch {return reply(400,{error:'Invalid JSON.'});}
      let config;
      if (path === '/api/diagnose') {
        let token;
        try { token = new URL(input.manifestUrl).pathname.match(/^\/addon\/([A-Za-z0-9_-]+)\/manifest\.json$/)?.[1]; } catch {}
        if (!token) return reply(400,{error:'Paste your full Family Streams HTTPS manifest link.'});
        config = unseal(token,secret);
        if (!['movie','series'].includes(input.type) || typeof input.id !== 'string' || !/^tt\d{5,12}(?::\d{1,4}:\d{1,5})?$/.test(input.id)) return reply(400,{error:'Enter an IMDb video ID, such as tt0133093 or tt0903747:1:1.'});
        const upstream = await aggregate(config,input.type,input.id,fetcher);
        // Deliberately test every configured group, independent of the browser's user agent.
        const selected = selectStreams(upstream.entries,{...config,settings:{...config.settings,mode:config.settings.mode==='universal'?'universal':'groups'}});
        return reply(200,{sources:upstream.sources,devices:selected.report,totalReturned:selected.streams.length,mode:config.settings.mode});
      }
      config = validateConfig(input);
      if (path === '/api/check') {
        const sources = await Promise.all(config.sources.map(async s=> {
          try {
            const data = await fetcher(s.url);
            const supportsStreams = Array.isArray(data.resources) && data.resources.some(r=>r === 'stream' || r?.name === 'stream');
            return {name:s.name, ok:Boolean(data.id && supportsStreams),message:data.id && supportsStreams ? 'Stream addon reached' : 'No stream resource in manifest'};
          } catch { return {name:s.name,ok:false,message:'Could not reach addon. Check its URL and hosting access.'}; }
        }));
        return reply(200,{sources});
      }
      const token = seal(config,secret);
      return reply(200,{path:`/addon/${token}/manifest.json`,devices:config.devices.length});
    }
    const match = path.match(/^\/addon\/([A-Za-z0-9_-]+)\/(manifest\.json|stream\/(movie|series)\/([^/]+)\.json)$/);
    if (!match) return reply(404,{error:'Not found.'});
    if (method !== 'GET') return reply(405,{error:'Use GET.'});
    const config = unseal(match[1],secret);
    if (match[2] === 'manifest.json') return reply(200,manifest(config));
    let id; try {id=decodeURIComponent(match[4]);} catch {return reply(400,{error:'Invalid video ID.'});}
    if (!/^tt\d{5,12}(?::\d{1,4}:\d{1,5})?$/.test(id)) return reply(200,{streams:[]});
    const {entries,failures} = await aggregate(config,match[3],id,fetcher);
    const result = selectStreams(entries,config,userAgent);
    return reply(200,{streams:result.streams,cacheMaxAge:0, ...(failures.length ? {warning:'Some sources could not be reached.'} : {})});
  } catch (error) {
    // Validation errors are fixed strings; never return upstream URLs or request bodies.
    return reply(400,{error:error.message});
  }
}
