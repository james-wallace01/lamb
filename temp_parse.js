const fs = require('fs');
const parser = require('@babel/parser');
const code = fs.readFileSync('src/App.js', 'utf8');

const start = code.indexOf('{view === "feed"');
const end = code.indexOf('{view === "vault"');
const sub = code.slice(start, end).replace(/`/g, '\\`');
const wrapped = `function Test(){return (<div>${sub}</div>);}`;

try {
  parser.parse(wrapped, {
    sourceType: 'module',
    plugins: ['jsx']
  });
  console.log('feed slice parses successfully');
} catch (e) {
  console.log(e.message);
  console.log(e.loc);
  console.log(e.codeFrame);
}
