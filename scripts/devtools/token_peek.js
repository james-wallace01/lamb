const fs = require('fs');
const parser = require('@babel/parser');
const code = fs.readFileSync('src/App.js', 'utf8');

let err;
try {
	parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
	console.log('ok');
	process.exit(0);
} catch (e) {
	err = e;
	console.log(e.message);
}

let ast;
try {
	ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true, tokens: true });
} catch (e2) {
	ast = e2.ast || { tokens: [] };
}
const pos = err.pos || 0;
const tokens = ast.tokens;
const near = tokens.filter(t => t.start > pos - 50 && t.start < pos + 50);
console.log('near tokens', near.map(t => ({ type: t.type.label, value: t.value, start: t.start, end: t.end })));
