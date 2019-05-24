const request=require('request');
const urlModule = require('url');
const crypto = require('crypto');
var sameTime = new require('./sameTime.js');

function now(){
  return (new Date()).getTime();
}


module.exports=function(options,listName){
  //per one chanel
  var downloadLimit=new sameTime(4);
  var queue =[];
  var files={};
  var listGetterTimeout=null;
  var lastPlayListReq;
  var baseUrl=options.playlist.replace(/\/[^\/]+$/,'/');
  var stat=this.stat={
    name:listName,
    files:0,
    filesCached:{},
    playlistsCached:0,
    loading:0,
    time:0
  };
  //var clearTime={};

  var statInterval=setInterval(function(){
    console.log('%j',stat);
  },15000);
  statInterval.unref();

  function fileCache(url,fileKey){
    var data=null;
    var headers=null;
    var resQueue=[];
    var finished=false;
    var errResponse=null;
    var thisFileCache=this;

    //console.log("file",url,fileKey);

    var processResponse=this.processResponse=function(res){
      if (!data) {
        resQueue.push(res);
        return;
      }

      res.writeHead(errResponse||200, {
        'Content-Length': data.length,
        'Content-Type': headers['content-type']
      })
      res.end(data);
//      console.log("Send cached file ",url);
    }
    var tryCount=0;
    var code=null;

    function getSegment(){
      tryCount++;
      stat.loading++;
      downloadLimit.runFirst(request.get,{url:url, encoding:null},(err,resp,rdata)=>{
        downloadLimit.e();
        stat.loading--;
        err && console.log(err);
        if (resp && resp.statusCode==200){
          headers=resp.headers;
          data=rdata;
          code=resp.statusCode;
          while (resQueue.length){
            processResponse(resQueue.pop());
          }
        }else if(resp && resp.statusCode==404 && tryCount<3){
          data=rdata;
          code=resp.statusCode;
          headers=resp.headers;
          errResponse=404;
          while (resQueue.length){
            processResponse(resQueue.pop());
          }
        }else{
          console.log("URL failed "+url+" tryAgain",resp && resp.statusCode);
          !finished && setTimeout(getSegment,500);
        }
        if (data && code){
          stat.filesCached[code]=stat.filesCached[code]||0;
          stat.filesCached[code]++;
          thisFileCache.prolongCleanTimeout();
        }
      });//request TS under limit
    }//getSegment
    setTimeout(getSegment,options.tsLoadDelay||50);
    this.time=now();
    stat.files++;

    var cleanTimeout;
    this.prolongCleanTimeout=function(){
      cleanTimeout && clearTimeout(cleanTimeout);
      cleanTimeout=setTimeout(function(){
        //console.log("Clean ts ",fileKey);
        delete files[fileKey];
        //clearTime[fileKey]=now();
        stat.files--;
        if (data && code && stat.filesCached[code]){
          stat.filesCached[code]--;
        }
        finished=true;

        while (resQueue.length){
          var res=resQueue.pop();
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Load segment timeout');
        }
      },options.bufferTime+options.cleanAfter);
      cleanTimeout.unref();
    }
    return this;
  }

  function getList(){
    var rtime=now();
    //var querystring = require("querystring");
    //console.log(querystring.stringify({query: options.playlist}));
    request.get(options.playlist+'?'+rtime,(err,resp,data)=>{
      err && console.log(err);
      if (!resp){
        console.log("Error "+options);
      }
      if (resp && resp.statusCode==200){
        //data=data.split(baseUrl).join('');
        var byLines=data.toString().split(/\r?\n/g);

//        byLines.forEach((line,idx)=>{
        var curCnt=0;
        var needNextLine=true;
        var filterListRe=new RegExp(options.filterListRe||'');
        for (var idx=byLines.length-1;idx>=0;idx--){
          var line=byLines[idx];

          if (line && /^\#/.test(line)){
            needNextLine=filterListRe.test(line) || idx<2;
            if (!needNextLine) byLines[idx]='';
          }else if (line && !needNextLine){
            byLines[idx]='';
          }else if (line && curCnt<(options.lastFilesCnt||300)){
            curCnt++;
            var url=line;
            //url=url.replace(baseUrl,'');
            if (!/^http/.test(url)){
              url=urlModule.resolve(options.playlist,url);
            }else{
	             //console.log("url:%s",url);
	          }
            var filename=line.replace(/(.*)\/([^\/]+)$/,'$2');
            var hash = crypto.createHash('md5').update(filename).
              digest("hex")+'.ts';
//(filename.replace(/([^\.]+)\.(.*)$/,'.$2')||'.raw')

            //console.log('TS url:%s fileKey:%s',url,hash);
            byLines[idx]=hash;
            //clearTime[hash] && console.log("HIT!",url);
            files[hash]=files[hash]||new fileCache(url,hash)
            //files[hash].prolongCleanTimeout();
          }
        }
        queue.unshift({
          time:rtime,
          playList:byLines.join("\n"),
          headers:resp.headers
        });
        stat.playlistsCached=queue.length;

        //Remove old playlists
        while(queue.length && (queue[queue.length-1].time<(rtime-(options.bufferTime+options.cleanAfter)))){
          let rmPls=queue.pop()
          //console.log("Clean play list ",new Date(rmPls.time));
        }
        var lastBuf=queue[queue.length-1];
        if (lastBuf){
          stat.time=now()-lastBuf.time;
        }
      }else{
        console.log("Can't load play list statusCode:%s data:%s",resp.statusCode,data);
      }
      if (lastPlayListReq && ((now()-lastPlayListReq)>(options.bufferTime+options.cleanAfter+15000))){
        console.log("stop list check cycle "+listName);
        queue=[];
        clearInterval(statInterval);
        listGetterTimeout=null;
      }else{
        listGetterTimeout=setTimeout(getList,options.checkInterval);
      }
    });//request.get
  }//getList

  function startFromUpstream(){
    if (listGetterTimeout)return;
    listGetterTimeout=setTimeout(getList,1);
  }

  var onPlayListReq=this.onPlayListReq=function(req,res){
    var curBuf=this;
    lastPlayListReq=now();
    startFromUpstream();
    if (!req) return;
    req.time=req.time||now();
    if ((now()-req.time)>(options.bufferTime+10000)){
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Can not get source m3u8');
      return
    }
    for (var i=0;i<queue.length;i++){

      if ((now()-queue[i].time)>options.bufferTime){
        //console.log("Send pls",req.socket.localAddress);
        res.writeHead(200, {
          'Content-Length': Buffer.byteLength(queue[i].playList),
          'Content-Type': queue[i].headers['content-type']
        })
        res.end(queue[i].playList);
        return;
      }
    }
    //console.log("nearest play list",now()-((queue[0] && queue[0].time)||now()));
    setTimeout(onPlayListReq,options.checkInterval,req,res);
  }

  var onFileReq=this.onFileReq=function(req,res){
    var fileKey=req.fileKey||req.url;

    function tryGetCachedFile(cycle){
      var file=files[fileKey];
      if (!file && cycle>3){
        console.log('404 fileKey:%s cycle:%s',fileKey,cycle);// clearTime[fileKey] && (now()-clearTime[fileKey]));//,ar.join('|'));
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      if (!file){
        console.log("wait file?!",req.url,fileKey);
        setTimeout(tryGetCachedFile,1000,cycle+1);
        return;
      }

      file.processResponse(res);
    }
    tryGetCachedFile(0);

  }

  return this;
}
