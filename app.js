const http=require('http');
const fs=require('fs');
var hlsBuffer=require('./lib/hlsBuffer.js');
//Разрешить любые поддельные сертификаты, например от грибова
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

var playListRe=/^\/([^\/]+)\/(.*\.m3u8)$/;
var nameSpaceRe=/^\/([^\/]+)\//;

var list=JSON.parse(fs.readFileSync('list.json'));
var config=list.config||{};
delete list.config;

var buffers={};
var server=http.createServer(function (req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  //console.log(req.url);
  var buf;
  if (nameSpaceRe.test(req.url)){
    var params=nameSpaceRe.exec(req.url);
    var listName=params[1];
    var opts=list[listName];
    if (!(opts && opts.playlist)){
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('list.json does not contain config for '+listName);
      return;
    }
    buf=buffers[listName]||new hlsBuffer(opts,buffers,listName);
  }
  if (!buf){
    console.log("Client req unknown url %s",req.url);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Unkonown');
    return
  }
  if (playListRe.test(req.url)){
    buf.onPlayListReq(req,res);
    return;
  }
  if (nameSpaceRe.test(req.url)){
    req.fileKey=req.url.replace(nameSpaceRe,'');
//    console.log('file req',listName,req.fileKey);
    buf.onFileReq(req,res);
  }
});

server.listen(config.listenPort||8080,config.listenHost||"0.0.0.0");
console.log("Server listen at %s:%s",config.listenHost||"0.0.0.0",config.listenPort||8080);
