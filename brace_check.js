const fs=require('fs');
const code=fs.readFileSync('src/App.js','utf8');
let stack=[];
let inStr=false,strCh='',escape=false,inLineComment=false,inBlockComment=false;
let line=1,col=0;
for(let i=0;i<code.length;i++){
  const ch=code[i];
  if(ch==='\n'){line++;col=0; if(inLineComment) inLineComment=false; continue;} else col++;
  if(inLineComment) continue;
  if(inBlockComment){if(ch==='*' && code[i+1]==='/'){inBlockComment=false;i++;col++;}continue;}
  if(inStr){
    if(escape){escape=false;continue;}
    if(ch==='\\'){escape=true;continue;}
    if(ch===strCh){inStr=false;strCh='';}
    continue;
  }
  if(ch==='/' && code[i+1]==='/'){inLineComment=true;i++;col++;continue;}
  if(ch==='/' && code[i+1]==='*'){inBlockComment=true;i++;col++;continue;}
  if(ch==="'" || ch==='"' || ch==='`'){inStr=true;strCh=ch;continue;}
  if(ch==='{'){stack.push({line,col});}
  if(ch==='}'){stack.pop();}
}
console.log('unclosed braces count', stack.length);
console.log('last few', stack.slice(-5));
