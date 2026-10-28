import { PROFILES, DEFAULT_DEVICES, capabilities } from './profiles.js';
import { selectStreams } from './engine.js';
const $ = selector => document.querySelector(selector);
const devices = DEFAULT_DEVICES.map(d=>({...d}));
let sourceCounter = 0;
let generatedURL = '';
let revision = 0;
const form = $('#config-form');
function el(tag, text, cls) { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(cls)node.className=cls; return node; }
function status(message, kind='') {const node=$('#form-status');node.textContent=message;node.className=`status ${kind}`;}
function invalidate() { revision++;generatedURL='';$('#result').hidden=true;$('#install-link').value='';$('#install').removeAttribute('href');status(''); }
function addSource(name='Custom addon') {
  if ($('#sources').children.length>=6) return;
  const id = ++sourceCounter, row=el('div',undefined,'source');
  const label=el('label','Source');const nameInput=el('input');nameInput.value=name;nameInput.maxLength=32;nameInput.dataset.role='name';nameInput.setAttribute('aria-label',`Source ${id} name`);label.append(nameInput);
  const urlLabel=el('label','Manifest URL');const wrap=el('div',undefined,'url-wrap');const urlInput=el('input');
  urlInput.type='password';urlInput.autocomplete='off';urlInput.spellcheck=false;urlInput.placeholder='https://…/manifest.json';urlInput.maxLength=1800;urlInput.dataset.role='url';urlInput.setAttribute('aria-label',`${name} manifest URL`);
  const reveal=el('button','Show','reveal');reveal.type='button';reveal.setAttribute('aria-label',`Show ${name} URL`);reveal.addEventListener('click',()=>{urlInput.type=urlInput.type==='password'?'text':'password';reveal.textContent=urlInput.type==='password'?'Show':'Hide';reveal.setAttribute('aria-label',`${reveal.textContent} ${nameInput.value} URL`);});
  wrap.append(urlInput,reveal);urlLabel.append(wrap);
  const remove=el('button','×','icon-button');remove.type='button';remove.setAttribute('aria-label',`Remove ${name} source`);remove.addEventListener('click',()=>{row.remove();invalidate();$('#add-source').disabled=false;});
  row.append(label,urlLabel,remove);$('#sources').append(row);$('#add-source').disabled=$('#sources').children.length>=6;
}
['Comet','Debridio','Torrentio'].forEach(addSource);
$('#add-source').addEventListener('click',()=>{addSource();invalidate();});

function deviceCheck(container,label,checked,change) {
  const l=el('label'),input=el('input');input.type='checkbox';input.checked=checked;input.addEventListener('change',()=>change(input.checked));l.append(input,document.createTextNode(label));container.append(l);
}
function renderDevices() {
  $('#devices').replaceChildren();
  devices.forEach((d,index)=> {
    const c=capabilities(d), card=el('div',undefined,'device'),top=el('div',undefined,'device-top');
    const symbol=el('span',['ios','android'].includes(c.family)?'▯':'▣','device-symbol');symbol.setAttribute('aria-hidden','true');
    const info=el('div',undefined,'device-info');info.append(el('strong',d.label),el('small',`${c.maxResolution}p · ${c.dv?'Dolby Vision':c.hdr?'HDR enabled':'SDR'} · ${c.codecs.includes('hevc')?'HEVC':'H.264'}`));
    const remove=el('button','×','icon-button');remove.type='button';remove.setAttribute('aria-label',`Remove ${d.label}`);remove.addEventListener('click',()=>{devices.splice(index,1);renderDevices();refresh();});top.append(symbol,info,remove);
    const details=el('details'),summary=el('summary','Device settings');const fields=el('div',undefined,'device-settings');
    fields.append(el('p',c.note));
    const resolutionLabel=el('label','Maximum resolution'),resolution=el('select');
    [720,1080,2160].forEach(r=>{const o=el('option',`${r}p`);o.value=r;o.selected=c.maxResolution===r;resolution.append(o);});
    resolution.addEventListener('change',()=>{d.maxResolution=Number(resolution.value);refresh();info.lastChild.textContent=`${d.maxResolution}p · Custom settings`;});resolutionLabel.append(resolution);fields.append(resolutionLabel);
    for (const [field,values] of Object.entries({codecs:[['h264','H.264 / AVC'],['hevc','H.265 / HEVC'],['av1','AV1'],['vp9','VP9']],audio:[['aac','AAC'],['ac3','Dolby Digital (AC3)'],['eac3','Dolby Digital Plus'],['mp3','MP3'],['dts','DTS / DTS-HD'],['truehd','Dolby TrueHD'],['flac','FLAC'],['opus','Opus']]})) {
      const fs=el('fieldset'),legend=el('legend',field==='codecs'?'Supported video':'Supported audio'),checks=el('div',undefined,'checks');
      values.forEach(([value,label])=>deviceCheck(checks,label,c[field].includes(value),checked=>{const set=new Set(d[field]||c[field]);checked?set.add(value):set.delete(value);d[field]=[...set];refresh();}));fs.append(legend,checks);fields.append(fs);
    }
    const visuals=el('div',undefined,'checks');
    deviceCheck(visuals,'HDR10 / HLG supported',c.hdr,v=>{d.hdr=v;refresh();});
    deviceCheck(visuals,'Dolby Vision supported',c.dv,v=>{d.dv=v;refresh();});fields.append(visuals,el('p','Enable formats only when your model, player, and display/audio chain support them. Dolby Vision profile variants cannot be reliably inferred from every release name.'));
    details.append(summary,fields);card.append(top,details);$('#devices').append(card);
  });
  const selected=new Set(devices.map(d=>d.profile));$('#new-device').replaceChildren();
  PROFILES.filter(p=>!selected.has(p.id)).forEach(p=>{const option=el('option',p.name);option.value=p.id;$('#new-device').append(option);});
  $('#add-device').disabled=devices.length>=8;
  const previous=$('#preview-device').value;$('#preview-device').replaceChildren(new Option('All selected devices','all'));
  devices.forEach(d=>$('#preview-device').append(new Option(d.label,d.profile)));
  if([...$('#preview-device').options].some(o=>o.value===previous))$('#preview-device').value=previous;
}
$('#add-device').addEventListener('click',()=>{const p=PROFILES.find(p=>p.id===$('#new-device').value);if(p&&devices.length<8){devices.push({profile:p.id,label:p.name});renderDevices();refresh();}});
function settings() {return {mode:form.elements.mode.value,limit:Number($('#limit').value),maxSizeGB:Number($('#max-size').value),priority:$('#priority').value,unknown:$('#unknown').value,hideUncached:$('#hide-uncached').checked,cachedOnly:$('#cached-only').checked,allowP2P:$('#allow-p2p').checked};}
function configuration() {
  const sources=[...$('#sources').children].map(row=>({name:row.querySelector('[data-role=name]').value.trim(),url:row.querySelector('[data-role=url]').value.trim()})).filter(s=>s.url);
  if (!sources.length) throw new Error('Paste at least one configured addon manifest link. Unused source rows can stay empty.');
  for(const s of sources){let u;try{u=new URL(s.url.replace(/^stremio:\/\//i,'https://'));}catch{throw new Error(`Check the ${s.name || 'source'} URL.`);}if(u.protocol!=='https:'||!u.pathname.endsWith('/manifest.json')||u.username||u.password||u.hash||(u.port&&u.port!=='443'))throw new Error(`${s.name}: use an HTTPS link ending in /manifest.json.`);if(!s.name)throw new Error('Give each source a name.');s.url=u.href;}
  if(!devices.length)throw new Error('Add at least one device.');
  if(devices.some(d=>!capabilities(d).codecs.length||!capabilities(d).audio.length))throw new Error('Select at least one video and audio format for each device.');
  return {sources,devices,settings:settings()};
}
function backend() {
  const value=$('#backend').value.trim();
  const base=new URL(value||location.origin);
  if(base.protocol!=='https:' && !(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname))) throw new Error('Use an HTTPS addon server URL.');
  if(base.username||base.password||base.search||base.hash||!['','/'].includes(base.pathname))throw new Error('Enter only the addon server origin, such as https://your-addon.netlify.app.');
  return base.origin;
}
async function api(path,data) {
  let response;
  try {response=await fetch(`${backend()}${path}`,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000),referrerPolicy:'no-referrer'});} catch {throw new Error('Could not reach the addon server. Check its URL and connection. A GitHub Pages frontend needs a deployed backend.');}
  let result;try{result=await response.json();}catch{throw new Error('This host is serving a webpage instead of the addon API. Deploy the included backend or enter its URL below.');}
  if(!response.ok)throw new Error(result.error||'The addon server could not complete this request.');return result;
}
$('#check-sources').addEventListener('click',async()=> {
  const node=$('#source-status'),button=$('#check-sources');button.disabled=true;node.className='status';node.textContent='Checking source manifests…';
  try{const result=await api('/api/check',configuration());node.textContent=result.sources.map(s=>`${s.ok?'✓':'!'} ${s.name}: ${s.message}`).join('\n');node.className=`status ${result.sources.every(s=>s.ok)?'success':'error'}`;}catch(e){node.textContent=e.message;node.className='status error';}finally{button.disabled=false;}
});
form.addEventListener('submit',async event=> {
  event.preventDefault();const button=$('#generate');button.disabled=true;invalidate();const submittedRevision=revision;status('Creating your shared addon link…');
  try {
    const result=await api('/api/config',configuration());if(!/^\/addon\/[A-Za-z0-9_-]+\/manifest\.json$/.test(result.path))throw new Error('The backend returned an invalid addon link.');
    if(submittedRevision!==revision){status('Your settings changed. Create a new link to include those changes.');return;}
    const candidate=backend()+result.path;
    status('Checking your new manifest before installation…');
    const check=await fetch(candidate,{signal:AbortSignal.timeout(15000),referrerPolicy:'no-referrer'});
    if(!check.ok)throw new Error(`Manifest check failed (HTTP ${check.status}). Check the backend deployment before installing.`);
    const verified=await check.json();
    if(!verified.id?.startsWith('community.familyfilter.'))throw new Error('The manifest URL did not return a valid Family Streams addon.');
    if(submittedRevision!==revision){status('Your settings changed. Create a new link to include those changes.');return;}
    generatedURL=candidate;$('#install-link').value=generatedURL;$('#install').href=generatedURL.replace(/^https?:\/\//,'stremio://');$('#result').hidden=false;status(`Ready: one addon with ${result.devices} device profile${result.devices===1?'':'s'}.`,'success');$('#result').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(e){status(e.message,'error');}finally{button.disabled=false;}
});
$('#copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(generatedURL);status('Install link copied. Keep it private.','success');}catch{$('#install-link').select();status('Select and copy the link above. Your browser blocked clipboard access.');}});
$('#test-link').addEventListener('click',async()=>{if(!generatedURL)return;status('Checking the manifest…');try{const response=await fetch(generatedURL,{signal:AbortSignal.timeout(15000),referrerPolicy:'no-referrer'});const data=await response.json();if(!response.ok||!data.id?.startsWith('community.familyfilter.'))throw new Error();status('Manifest verified. Live playback still depends on your sources and device.','success');}catch{status('The manifest could not be verified. Check your backend configuration.','error');}});

const demo = [
  ['Comet','The.Open.Road.2160p.HEVC.HDR10.EAC3.mkv',14,'[RD+]'],
  ['Torrentio','The.Open.Road.1080p.HEVC.AAC.mkv',2.6,'[RD+]'],
  ['Debridio','The.Open.Road.1080p.H264.AAC.mp4',3.8,'Cached'],
  ['Comet','The.Open.Road.720p.H264.AAC.mp4',1.1,'Cached'],
  ['Torrentio','The.Open.Road.2160p.DV.TrueHD.HEVC.mkv',54,'[RD+]'],
  ['Debridio','The.Open.Road.1080p.H264.AAC.mkv',4.2,'Uncached'],
  ['Comet','The.Open.Road.1080p.H264.DTS.mkv',7.1,'Cached'],
  ['Torrentio','The.Open.Road.2160p.HEVC.AAC.mkv',11,'[RD+]'],
].map(([provider,filename,size,cache],i)=>({provider,stream:{url:`https://demo.invalid/${i}`,name:cache,behaviorHints:{filename,videoSize:size*1e9}}}));
function renderPreview(){
  const node=$('#stream-preview');node.replaceChildren();
  if(!devices.length){node.append(el('p','Add a device to preview its filters.'));$('#preview-summary').textContent='No devices selected';return;}
  const cfg={devices,settings:settings()}, result=selectStreams(demo,cfg);
  const selected=$('#preview-device').value;
  const d=devices.find(d=>d.profile===selected);
  const rows=result.streams.filter(s=>!d||cfg.settings.mode==='universal'||s.name.startsWith(d.label+'\n'));
  // Keep the visual preview compact while reporting the complete list size.
  rows.slice(0,4).forEach(s=>{const [label,quality]=s.name.split('\n'),card=el('div',undefined,`stream-card ${quality.includes('Top match')?'top':''}`),row=el('div',undefined,'row');row.append(el('strong',label),el('span','▷','play'));card.append(row,el('h4',quality),el('p',s.description.split('\n')[0]));node.append(card);});
  if(!rows.length)node.append(el('p','No demo streams match these settings. Try adjusting your filters.'));
  $('#preview-summary').textContent=`${rows.length} demo matches${rows.length>4?' · showing first 4':''} · ${demo.length} example sources`;
}
function refresh(){invalidate();renderPreview();}
form.addEventListener('input',refresh);form.addEventListener('change',refresh);
$('#preview-device').addEventListener('change',renderPreview);
renderDevices();renderPreview();
if(location.hostname.endsWith('github.io')){$('#hosting-options').open=true;$('#backend').placeholder='Required: https://your-addon.netlify.app';}
