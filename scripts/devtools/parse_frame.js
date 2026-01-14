const fs=require('fs');
const parser=require('@babel/parser');
const {codeFrameColumns}=require('@babel/code-frame');
const code=fs.readFileSync('src/App.js','utf8');
try{parser.parse(code,{sourceType:'module',plugins:['jsx']});console.log('ok');}
catch(e){console.log(e.message);console.log(codeFrameColumns(code,{start:{line:e.loc.line,column:e.loc.column+1}}));}
