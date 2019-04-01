module.exports=function(maxThreads){
  //timeout=timeout||5;
  var thism=this;
  this.queue=[];
  this.runed=0;
  this.run=function(thisObj,fn){
    var func;
    if (typeof(thisObj)=='function') {
      //Have no thisObj
      func=thisObj;
      thisObj=undefined;
    }else
      func=fn;
    if(!func) return;
    //console.log("Args obj 12 ",arguments[1],arguments[2]);
    var args = Array.prototype.slice.call(arguments,(thisObj)?2:1);
    //console.log(args);
    thism.queue.push({
      fn:func,
      thisObj:thisObj,
      args:args
    });

    thism.tryRun();
  };
  this.runFirst=function(thisObj,fn){
    var func;
    if (typeof(thisObj)=='function') {
      //Have no thisObj
      func=thisObj;
      thisObj=undefined;
    }else
      func=fn;
    if(!func) return;
    //console.log("Args obj 12 ",arguments[1],arguments[2]);
    var args = Array.prototype.slice.call(arguments,(thisObj)?2:1);
    //console.log(args);
    thism.queue.unshift({
      fn:func,
      thisObj:thisObj,
      args:args
    });

    thism.tryRun();
  };
  this.tryRun=function(){
    if (thism.runed<maxThreads){
      var toRunObj=thism.queue.shift();
      if (!toRunObj){
        //console.log('ending');
        return;
      }
      thism.runed++;

      //console.log("Run, elapsed:%s",thism.queue.length);
      //Запуск работы на следующем обороте.
      process.nextTick(function(inoo){
        var ino=inoo||toRunObj;
        ino && ino.fn.apply(ino.thisObj,ino.args);
        !ino && thism.e();
      },toRunObj);
    }
  };
  this.e=function(){
    this.runed--;
    thism.tryRun();
  };
};
