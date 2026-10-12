import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
http.createServer(async(req,res)=>{
  try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(pathname==='/'?'/app.html':pathname));if(!file.startsWith(root))throw new Error('outside root');const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[path.extname(file)]||'text/plain'));res.end(data);}catch{res.writeHead(404);res.end('Not found');}
}).listen(5179,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:5179/app.html'));
