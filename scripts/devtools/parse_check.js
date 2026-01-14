const fs = require('fs');
const parser = require('@babel/parser');
const code = fs.readFileSync('src/App.js', 'utf8');
try {
  parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  console.log('parse ok');
} catch (e) {
  console.log(e.message);
  console.log(e.loc);
  console.log(e.codeFrame);
}
