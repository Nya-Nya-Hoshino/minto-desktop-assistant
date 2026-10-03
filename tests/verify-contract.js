'use strict';
const fs=require('node:fs');const path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');if(!source.includes("'contour'")){process.stderr.write('Missing actual contour verification\n');process.exitCode=1;}
