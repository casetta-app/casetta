// Independent encodings from EAN L/G/R digit and ITF interleaving tables.
const fs = require('node:fs')
const path = require('node:path')
const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
const G = L.map(x => [...x].reverse().map(b => b === '1' ? '0' : '1').join(''))
const R = L.map(x => [...x].map(b => b === '1' ? '0' : '1').join(''))
const parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']
const itf = ['nnwwn','wnnnw','nwnnw','wwnnn','nnwnw','wnwnn','nwwnn','nnnww','wnnwn','nwnwn']
function ean(code) {
  if (code.length === 12) code = '0' + code
  if (code.length === 8) return '101' + [...code.slice(0,4)].map(d=>L[d]).join('') + '01010' + [...code.slice(4)].map(d=>R[d]).join('') + '101'
  return '101' + [...code.slice(1,7)].map((d,i)=>(parity[code[0]][i] === 'L' ? L : G)[d]).join('') + '01010' + [...code.slice(7)].map(d=>R[d]).join('') + '101'
}
function interleaved(code) {
  let bits = '1010'
  for (let i=0;i<code.length;i+=2) for(let j=0;j<5;j++) bits += '1'.repeat(itf[code[i]][j]==='w'?3:1) + '0'.repeat(itf[code[i+1]][j]==='w'?3:1)
  return bits + '11101'
}
const samples = [
 ['ean13','9771125522005','ean',true], ['ean8','96385074','ean',true],
 ['upca','036000291452','ean',true], ['itf14','10012345000017','itf',true],
 ['bad-checksum','9771125522006','ean',false], ['blank','','blank',false],
].map(([name,code,type,valid]) => {
 const bits = '0'.repeat(20) + (type==='blank'?'0'.repeat(95):type==='itf'?interleaved(code):ean(code)) + '0'.repeat(20)
 const rects = [...bits].map((b,i)=>b==='1'?`<rect x="${i*3}" y="0" width="3" height="160"/>`:'').join('')
 fs.writeFileSync(path.join(__dirname,name+'.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="${bits.length*3}" height="190" viewBox="0 0 ${bits.length*3} 190"><rect width="100%" height="100%" fill="white"/><g fill="black">${rects}</g><text x="60" y="180" font-size="16">${code}</text></svg>\n`)
 return {name,code,valid,bits,width:bits.length*3,height:160}
})
fs.writeFileSync(path.join(__dirname,'samples.json'),JSON.stringify(samples,null,2)+'\n')
