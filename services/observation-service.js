'use strict';
const {createHash}=require('node:crypto');
class ObservationGate {
  constructor(cooldownMs=120000){this.cooldownMs=cooldownMs;this.lastSpoken=0;this.lastChecked=-Infinity;this.lastHash=null;}
  check(frame,now,busy){if(busy||now-this.lastSpoken<this.cooldownMs||now-this.lastChecked<this.cooldownMs)return false;this.lastHash=createHash('sha256').update(frame).digest('hex');this.lastChecked=now;return true;}
  markSpoken(now){this.lastSpoken=now;}
  reset(){this.lastHash=null;this.lastChecked=-Infinity;}
}
module.exports={ObservationGate};
