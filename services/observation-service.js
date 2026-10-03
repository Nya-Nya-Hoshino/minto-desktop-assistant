'use strict';
const {createHash}=require('node:crypto');
class ObservationGate {
  constructor(cooldownMs=120000){this.cooldownMs=cooldownMs;this.lastSpoken=0;this.lastHash=null;}
  check(frame,now,busy){if(busy||now-this.lastSpoken<this.cooldownMs)return false;const hash=createHash('sha256').update(frame).digest('hex');if(hash===this.lastHash)return false;this.lastHash=hash;return true;}
  markSpoken(now){this.lastSpoken=now;}
  reset(){this.lastHash=null;}
}
module.exports={ObservationGate};
