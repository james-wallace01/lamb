const fs=require('fs');
const code=fs.readFileSync('src/App.js','utf8');
const start=code.indexOf('{view === "feed"');
const end=code.indexOf('{view === "vault"');
const sub=code.slice(start,end);
const open=(sub.match(/<div\b/gi)||[]).length;
const close=(sub.match(/<\/div>/gi)||[]).length;
console.log('feed div open',open,'close',close);

// Find unmatched opening div positions within feed block
const regex=/<\/?div\b[^>]*>/ig;let stack=[];let m;
while((m=regex.exec(sub))){
	if(m[0].startsWith('</')){
		stack.pop();
	} else {
		const globalIndex=start+regex.lastIndex;
		stack.push({globalIndex,match:m[0],localIndex:regex.lastIndex});
	}
}
console.log('unmatched openings',stack.slice(-5));
