import {execFileSync} from 'node:child_process';
import path from 'node:path';

const packages = ['lodash/assignIn', 'lodash/isArray', 'lodash/isString', 'lodash/isFunction', 'lodash/isNumber', 'lodash/isObject', 'lodash/size', 'lodash/template', 'clone'];

export function runtimeDependencyPaths(suiteDir: string): string[] {
  const suitePackage = path.join(suiteDir, 'package.json');
  const script = `const path=require('node:path');const r=require('node:module').createRequire(process.argv[1]);for(const n of ${JSON.stringify(packages)})r(n);const d=path.join(path.dirname(process.argv[1]),'node_modules');process.stdout.write(JSON.stringify(Object.keys(require.cache).filter(f=>{const x=path.relative(d,f).split(path.sep);return !x[0].startsWith('..')&&['lodash','clone'].includes(x[0])}).concat([r.resolve('lodash/package.json'),r.resolve('clone/package.json')]).filter((f,i,a)=>a.indexOf(f)===i).map(f=>path.relative(d,f)).sort()))`;
  return JSON.parse(execFileSync(process.execPath, ['-e', script, suitePackage], {cwd: suiteDir, encoding: 'utf8', windowsHide: true}));
}
