import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, seal, unseal, manifest, DEFAULT_SETTINGS, addonURL } from '../lib/config.mjs';
import { parseStream, assess, selectStreams, detectedDevices } from '../public/engine.js';
import { publicAddress, streamURL, fetchJSON, aggregate } from '../lib/upstream.mjs';
import { handle } from '../lib/api.mjs';
import { DEFAULT_DEVICES } from '../public/profiles.js';
import { handler as netlifyHandler } from '../netlify/functions/addon.mjs';
const secret='test-secret-with-more-than-thirty-two-characters';
const config=()=>validateConfig({sources:[{name:'Comet',url:'https://comet.example/config-secret/manifest.json'}],devices:DEFAULT_DEVICES,settings:DEFAULT_SETTINGS});
const stream=(filename='Movie.1080p.H264.AAC.mp4',extra={})=>({url:'https://media.example/video.mp4',name:'[RD+]',behaviorHints:{filename,videoSize:2e9,bingeGroup:'upstream-1080'},...extra});
test('one manifest covers all four family devices with no personal labels',()=>{
  const m=manifest(config());assert.equal(m.resources.length,1);assert.equal(m.catalogs.length,0);assert.match(m.name,/Family Streams/);assert.doesNotMatch(m.description,/Mom|Dad|Jackson/);assert.equal(m.id,manifest(config()).id);
});
test('tokens encrypt configuration and reject tampering or a changed key',()=>{
  const c=config(),token=seal(c,secret);assert.deepEqual(unseal(token,secret),c);assert.ok(!Buffer.from(token,'base64url').toString().includes('config-secret'));
  const b=Buffer.from(token,'base64url');b[30]^=1;assert.throws(()=>unseal(b.toString('base64url'),secret));assert.throws(()=>unseal(token,secret+'different'));assert.throws(()=>seal(c,'short'));
});
test('configuration validates sources, device capabilities and resource bounds',()=>{
  assert.equal(addonURL('stremio://addon.example/key/manifest.json'),'https://addon.example/key/manifest.json');
  for(const url of ['http://x.example/manifest.json','https://u:p@x.example/manifest.json','https://x.example:8443/manifest.json','https://x.example/manifest.json#secret','https://x.example/foo'])assert.throws(()=>addonURL(url));
  for(const modification of [{devices:[]},{sources:[]},{settings:{limit:100}},{settings:{maxSizeGB:-1}},{settings:{mode:'magic'}},{settings:{allowP2P:'false'}},{devices:[{profile:'imaginary',label:'X'}]},{devices:[{profile:'mac',label:'Mac',codecs:[]}]}])assert.throws(()=>validateConfig({...config(),...modification}));
});
test('parses common provider labels, codecs, audio, size and cache state',()=>{
  const p=parseStream(stream('Film.2160p.DV.HDR10.HEVC.DDP5.1.mkv',{name:'[RD+] 12.5 GB',behaviorHints:{filename:'Film.2160p.DV.HDR10.HEVC.DDP5.1.mkv'}}));
  assert.equal(p.resolution,2160);assert.deepEqual(p.codecs,['hevc']);assert.deepEqual(p.audio,['eac3']);assert.equal(p.dv,true);assert.equal(p.hdr,true);assert.equal(p.bytes,12.5e9);assert.equal(p.cached,true);
  assert.equal(parseStream(stream(undefined,{name:'[RD download] Uncached'})).cached,false);
  assert.deepEqual(parseStream(stream('Film.1080p.H.264.E-AC-3.mkv')).audio,['eac3']);
});
test('known incompatibilities stay excluded even when no alternatives exist',()=>{
  const cfg=config();cfg.devices=[{profile:'fire-tv',label:'Fire TV'}];
  for(const filename of ['Film.2160p.H264.AAC.mp4','Film.1080p.HEVC.AAC.mkv','Film.1080p.H264.DTS.mkv','Film.1080p.H264.AAC.DV.mkv','Film.1080p.H264.AAC.HDR.mkv','Film.1080p.H264.AAC.HDCAM.mp4']){
    assert.equal(selectStreams([{provider:'Test',stream:stream(filename)}],cfg).streams.length,0,filename);
  }
});
test('unknown metadata is fallback, not a compatibility guarantee',()=>{
  const cfg=config();cfg.devices=[{profile:'fire-tv',label:'Fire TV'}];
  const unknown={provider:'Unknown',stream:{url:'https://media.example/unknown'}};
  const result=selectStreams([unknown],cfg);assert.match(result.streams[0].name,/Details incomplete/);
  assert.equal(selectStreams([unknown,{provider:'Known',stream:stream()}],cfg).streams.length,1);
  cfg.settings.unknown='exclude';assert.equal(selectStreams([unknown],cfg).streams.length,0);
});
test('browser excludes MKV, proxy-header and non-web-ready sources',()=>{
  const device={profile:'browser',label:'Browser'};
  for(const s of [stream('Film.1080p.H264.AAC.mkv'),stream(undefined,{behaviorHints:{notWebReady:true}}),stream(undefined,{behaviorHints:{proxyHeaders:{request:{Authorization:'secret'}}}})])assert.equal(assess(s,device,DEFAULT_SETTINGS).eligible,false);
  assert.equal(assess(stream(),device,DEFAULT_SETTINGS).eligible,true);
});
test('automatic routing is conservative and ambiguous TV requests get all device groups',()=>{
  const d=config().devices;
  assert.equal(detectedDevices(d,'Stremio AndroidTV').length,4);
  assert.equal(detectedDevices(d,'Stremio AFTMM')[0].profile,'fire-tv');
  assert.equal(detectedDevices(d,'Stremio iPhone')[0].profile,'ios');
  assert.equal(detectedDevices(d,'Mozilla iPhone Safari').length,4);
  assert.equal(detectedDevices([...d,{profile:'fire-tv-4k',label:'Other Fire'}],'Stremio AFTMM').length,5);
});
test('shared mode uses the intersection of all device filters',()=>{
  const cfg=config();cfg.settings.mode='universal';
  const result=selectStreams([{provider:'Test',stream:stream('Movie.1080p.HEVC.AAC.mkv')},{provider:'Test',stream:stream()}],cfg);
  assert.equal(result.streams.length,1);assert.match(result.streams[0].name,/Everyone/);
});
test('deduplication preserves playback details and separates autoplay groups',()=>{
  const original=stream(undefined,{behaviorHints:{filename:'Film.1080p.H264.AAC.mp4',proxyHeaders:{request:{'User-Agent':'Custom'}},videoHash:'abc',bingeGroup:'1080'}});
  const cfg=config();const result=selectStreams([{provider:'A',stream:original},{provider:'B',stream:original}],cfg);
  assert.equal(result.streams.length,4);assert.equal(result.streams[0].url,original.url);assert.deepEqual(result.streams[0].behaviorHints.proxyHeaders,original.behaviorHints.proxyHeaders);assert.equal(result.streams[0].behaviorHints.videoHash,'abc');assert.notEqual(result.streams[0].behaviorHints.bingeGroup,result.streams[1].behaviorHints.bingeGroup);
});
test('direct torrents are opt-in and size/cache controls work',()=>{
  const p2p=stream(undefined,{url:undefined,infoHash:'a'.repeat(40),fileIdx:3});
  assert.equal(assess(p2p,DEFAULT_DEVICES[0],DEFAULT_SETTINGS).eligible,false);
  assert.equal(assess(p2p,DEFAULT_DEVICES[0],{...DEFAULT_SETTINGS,allowP2P:true}).eligible,true);
  assert.equal(assess(stream(),DEFAULT_DEVICES[0],{...DEFAULT_SETTINGS,maxSizeGB:1}).eligible,false);
  assert.equal(assess(stream(undefined,{name:'Unknown'}),DEFAULT_DEVICES[0],{...DEFAULT_SETTINGS,cachedOnly:true}).eligible,false);
});
test('SSRF checks reject private, mapped, link-local, documentation and transition addresses',()=>{
  for(const address of ['127.0.0.1','10.1.1.1','192.168.1.3','169.254.169.254','100.100.100.200','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1','2002:7f00:1::'])assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('DNS private resolution and allowlist fail before outbound connection',async()=>{
  await assert.rejects(fetchJSON('https://example.com/manifest.json',{resolve:async()=>[{address:'127.0.0.1',family:4}]}),/public IP/);
  await assert.rejects(fetchJSON('https://example.com/manifest.json',{allowedHosts:'other.example'}),/not allowed/);
});
test('slow DNS is included in timeout budget',async()=>{
  await assert.rejects(fetchJSON('https://example.com/manifest.json',{timeout:5,resolve:()=>new Promise(resolve=>setTimeout(()=>resolve([{address:'127.0.0.1',family:4}]),20))}),/timed out/);
});
test('upstream URL preserves configured paths, queries and episode IDs',()=>{
  const u=streamURL('https://addon.example/config/manifest.json?token=abc','series','tt1234567:2:3');
  assert.equal(u.pathname,'/config/stream/series/tt1234567%3A2%3A3.json');assert.equal(u.search,'?token=abc');
});
test('a failing provider does not lose successful provider results',async()=>{
  const cfg=config();cfg.sources.push({name:'Fail',url:'https://fail.example/manifest.json'});
  const result=await aggregate(cfg,'movie','tt1234567',async u=>{if(u.hostname==='fail.example')throw Error('sensitive URL');return {streams:[stream()]};});
  assert.equal(result.entries.length,1);assert.deepEqual(result.failures,['Fail']);
});
test('end-to-end API creates one link, serves manifest and filters episode results',async()=>{
  const dependencies={secret,fetcher:async()=>({streams:[stream()]})};
  const create=await handle({method:'POST',path:'/api/config',body:JSON.stringify(config()),client:'integration'},dependencies);
  assert.equal(create.status,200);const {path}=JSON.parse(create.body);assert.match(path,/\/manifest.json$/);
  const m=await handle({path,client:'integration'},dependencies);assert.equal(m.status,200);assert.equal(JSON.parse(m.body).name,'Family Streams');
  const result=await handle({path:path.replace('manifest.json','stream/series/tt1234567%3A1%3A2.json'),userAgent:'Stremio AndroidTV',client:'integration'},dependencies);
  assert.equal(result.status,200);assert.equal(JSON.parse(result.body).streams.length,4);assert.equal(result.headers['Access-Control-Allow-Origin'],'*');assert.equal(result.headers['Cache-Control'],'no-store');
  const narrow=await handle({path:path.replace('manifest.json','stream/movie/tt1234567.json'),userAgent:'Stremio AFTMM',client:'integration'},dependencies);
  assert.equal(JSON.parse(narrow.body).streams.length,1);assert.match(JSON.parse(narrow.body).streams[0].name,/Fire TV/);
});
test('API fails clearly on invalid JSON, missing secret and unsupported routes',async()=>{
  assert.equal((await handle({method:'POST',path:'/api/config',body:'{bad',client:'invalid'},{secret})).status,400);
  assert.equal((await handle({method:'POST',path:'/api/config',body:'{}',client:'invalid'},{secret:''})).status,503);
  assert.equal((await handle({path:'/not-found',client:'invalid'},{secret})).status,404);
  assert.equal((await handle({method:'POST',path:'/api/config',body:'x'.repeat(16001),client:'invalid'},{secret})).status,413);
});
test('Netlify adapter supports original and rewritten paths and base64 request bodies',async()=>{
  const previous=process.env.CONFIG_SECRET;process.env.CONFIG_SECRET=secret;
  try {
    const created=await netlifyHandler({httpMethod:'POST',path:'/.netlify/functions/addon/api/config',headers:{},isBase64Encoded:true,body:Buffer.from(JSON.stringify(config())).toString('base64')});
    assert.equal(created.statusCode,200);const path=JSON.parse(created.body).path;
    for(const rawUrl of ['https://example.netlify.app'+path,'https://example.netlify.app/.netlify/functions/addon'+path]){
      const response=await netlifyHandler({httpMethod:'GET',rawUrl,headers:{}});assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).name,'Family Streams');
    }
  } finally {if(previous===undefined)delete process.env.CONFIG_SECRET;else process.env.CONFIG_SECRET=previous;}
});

test('compressed links are shorter and legacy uncompressed links still decrypt',()=>{
  const c=config(),token=seal(c,secret);
  assert.ok(token.length < Buffer.byteLength(JSON.stringify(c))*4/3);
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(c)),cipher.final()]);
  const legacy=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
  assert.deepEqual(unseal(legacy,secret),c);
});

test('empty restored filter choices use documented defaults',()=>{
  for(const empty of ['', '  ', null]){
    const c=validateConfig({...config(),settings:{mode:empty,priority:empty,unknown:empty}});
    assert.deepEqual(c.settings,DEFAULT_SETTINGS);
  }
  assert.throws(()=>validateConfig({...config(),settings:{mode:'invalid'}}),/how results should appear/);
  assert.throws(()=>validateConfig({...config(),settings:{priority:'invalid'}}),/sorting preference/);
  assert.throws(()=>validateConfig({...config(),settings:{unknown:'invalid'}}),/missing stream details/);
});
test('all UI filter combinations create valid manifest links',async()=>{
  for(const mode of ['auto','groups','universal'])for(const priority of ['quality','smaller'])for(const unknown of ['fallback','exclude']){
    const c={...config(),settings:{...DEFAULT_SETTINGS,mode,priority,unknown}};
    const response=await handle({method:'POST',path:'/api/config',body:JSON.stringify(c),client:'combinations'},{secret});
    assert.equal(response.status,200,`${mode}/${priority}/${unknown}`);
    const manifestResponse=await handle({path:JSON.parse(response.body).path,client:'combinations'},{secret});
    assert.equal(manifestResponse.status,200);
  }
});

test('live diagnostics distinguish upstream failures, zero results, and filtered results without leaking links',async()=>{
  const c=config();c.devices=[{profile:'fire-tv',label:'Fire TV'}];
  c.sources.push({name:'Empty',url:'https://empty.example/manifest.json'},{name:'Failed',url:'https://failed.example/secret/manifest.json'});
  const token=seal(c,secret);
  const fetcher=async u=>{if(u.hostname==='failed.example')throw Error('Source returned HTTP 403');if(u.hostname==='empty.example')return {streams:[]};return {streams:[stream('Film.2160p.HEVC.TrueHD.mkv')]};};
  const result=await handle({method:'POST',path:'/api/diagnose',body:JSON.stringify({manifestUrl:`https://addon.example/addon/${token}/manifest.json`,type:'movie',id:'tt0133093'}),client:'diagnostics'},{secret,fetcher});
  assert.equal(result.status,200);const data=JSON.parse(result.body);
  assert.equal(data.sources[0].count,1);assert.equal(data.sources[1].count,0);assert.equal(data.sources[1].ok,true);assert.equal(data.sources[2].ok,false);assert.equal(data.sources[2].message,'Source returned HTTP 403');
  assert.equal(data.totalReturned,0);assert.equal(data.devices[0].reasons.Resolution,1);assert.equal(data.devices[0].reasons['Video codec'],1);
  assert.ok(!result.body.includes('https://'));assert.ok(!result.body.includes(token));
});
test('diagnostics rejects invalid installed links and IDs without contacting any source',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return {streams:[]};};
  for(const input of [{manifestUrl:'https://example.com/manifest.json',type:'movie',id:'tt0133093'},{manifestUrl:`https://addon.example/addon/${seal(config(),secret)}/manifest.json`,type:'movie',id:'../bad'}]){
    const result=await handle({method:'POST',path:'/api/diagnose',body:JSON.stringify(input),client:'diag-invalid'},{secret,fetcher});assert.equal(result.status,400);
  }
  assert.equal(calls,0);
});
