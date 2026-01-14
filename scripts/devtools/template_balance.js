const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');let inTemplate=false,braceDepth=0,issues=[];for(let i=0;i<code.length;i++){const ch=code[i];const prev=code[i-1];if(!inTemplate){if(ch==='`'){inTemplate=true;braceDepth=0;}
  continue;}
// in template
if(ch==='`' && braceDepth===0){inTemplate=false;continue;}
if(ch==='{' && prev==='$'){braceDepth++;}
else if(ch==='{' ){braceDepth++;}
else if(ch==='}' && braceDepth>0){braceDepth--;}
if(i===code.length-1 && (inTemplate||braceDepth!==0))issues.push({pos:i,braceDepth,inTemplate});}
console.log('done', {inTemplate,braceDepth,issues});