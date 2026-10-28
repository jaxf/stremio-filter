import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { handle } from './lib/api.mjs';
const publicRoot = fileURLToPath(new URL('./public/',import.meta.url));
const files = new Set(['index.html','style.css','app.js','profiles.js','engine.js']);
const types = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8'};
export const server = http.createServer(async (req,res)=> {
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (path.startsWith('/api/') || path.startsWith('/addon/')) {
      const chunks=[]; let bytes=0;
      for await (const chunk of req) {bytes+=chunk.length; if(bytes>16_000){res.writeHead(413);res.end('Request too large');return;} chunks.push(chunk);}
      const result = await handle({method:req.method,path,body:Buffer.concat(chunks).toString(),userAgent:req.headers['user-agent']||'',client:req.socket.remoteAddress});
      res.writeHead(result.status,result.headers); res.end(result.body); return;
    }
    const file = path === '/' || path === '/configure' ? 'index.html' : path.slice(1);
    if (!files.has(file) || !['GET','HEAD'].includes(req.method)) {res.writeHead(404);res.end('Not found');return;}
    const data = await readFile(publicRoot+file);
    res.writeHead(200,{'Content-Type':types[file.split('.').pop()],'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'"});
    res.end(req.method==='HEAD'?undefined:data);
  } catch {res.writeHead(500);res.end('Server error');}
});
const portArgument = process.argv.indexOf('--port');
const port = portArgument >= 0 ? Number(process.argv[portArgument+1]) : Number(process.env.PORT)||3000;
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port,'0.0.0.0',()=>console.log('Family Streams server ready'));
