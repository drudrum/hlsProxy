const request=require('request');
const urlModule = require('url');
const crypto = require('crypto');
var sameTime = new require('./sameTime.js');

function now(){
  return (new Date()).getTime();
}


module.exports=function(options,parent,listName){
  parent[listName]=this;
  var downloadLimit=new sameTime(1);
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
    stat.unusedTime=Math.floor((now()-lastPlayListReq)/1000)+'sec';
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
    var responseQueue=function(){
      while (resQueue.length){
        processResponse(resQueue.pop());
      }
    }
    var tryCount=0;
    var code=null;

    function getSegment(){
      tryCount++;
      stat.loading++;
      downloadLimit.runFirst(function(){
        var timeout=setTimeout(function(){
          timeout=null;
          downloadLimit.e();
          stat.loading--;
          req.end();
          //Если ответа нет 10 раз, то оставить затею, получить этот файл.
          if (tryCount>10){
            data="Connect timeout more then 10 times";
            code=510;
            headers={};
            errResponse=510;
            return;
          }
          getSegment();
        },30000);
        var req=request.get({
          url:url,
          encoding:null,
          timeout:20000
        },(err,resp,rdata)=>{
          if (!timeout) return;

          clearTimeout(timeout);
          timeout=null;

          downloadLimit.e();
          stat.loading--;
          err && console.log(err);
          if (resp && resp.statusCode==200){
            headers=resp.headers;
            data=rdata;
            code=resp.statusCode;
            responseQueue();
          }else if(resp && resp.statusCode==404 && tryCount<3){
            data=rdata;
            code=resp.statusCode;
            headers=resp.headers;
            errResponse=404;
            responseQueue();
          }else{
            console.log("URL failed "+url+" tryAgain",resp && resp.statusCode);
            !finished && setTimeout(getSegment,5000);
          }
          thisFileCache.prolongCleanTimeout();
          if (data && code){
            stat.filesCached[code]=stat.filesCached[code]||0;
            stat.filesCached[code]++;
          }
        });//request TS
      });//under limit
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
    var responseTimeout=setTimeout(function(){
      responseTimeout=null;
      console.log("response timeout",listName);
      listGetterTimeout=setTimeout(getList,options.checkInterval);
      req.end();
    },30000);
    //console.log("Get list",listName);
    var req=request.get({
      url:options.playlist+'?'+rtime,
      timeout:10000
    },(err,resp,data)=>{
      //console.log("Req response",listName,resp && resp.statusCode);
      if (!responseTimeout) return;
      clearTimeout(responseTimeout);
      responseTimeout=null;

      err && console.log(err);
      if (!resp){
        console.log("Error "+options);
      }
      if (resp && resp.statusCode==200){
        var byLines=data.toString().split(/\r?\n/g);
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
            var hash = crypto.createHash('md5').update(filename).digest("hex")+'.ts';
            byLines[idx]=hash;
            files[hash]=files[hash]||new fileCache(url,hash)

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
          stat.time=Math.floor((now()-lastBuf.time)/1000)+'sec';
        }
      }else{
        console.log("Can't load play list statusCode:%s data:%s",resp && resp.statusCode,data);
      }

      if (lastPlayListReq && ((now()-lastPlayListReq)>(options.bufferTime+options.cleanAfter+15000))){
        console.log("stop list check cycle "+listName);
        delete parent[listName];
        queue=[];
        clearInterval(statInterval);
        listGetterTimeout=null;
      }else{
        //console.log("setTimeout to get m3u8",listName);
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
      if (!file && cycle>6){
        console.log('404 fileKey:%s cycle:%s',fileKey,cycle);// clearTime[fileKey] && (now()-clearTime[fileKey]));//,ar.join('|'));
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      if (!file){
        console.log("Cache does not contain file:",req.url);
        setTimeout(tryGetCachedFile,5000,cycle+1);
        return;
      }

      file.processResponse(res);
    }
    tryGetCachedFile(0);

  }

  return this;
}
