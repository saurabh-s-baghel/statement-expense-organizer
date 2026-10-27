import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = candidates.filter(file => /(^|\/)private\/|(^|\/)(flow|explain)\.md$|(^|\/)\.env(?!\.example$)|(^|\/)(node_modules|test-results[^/]*|playwright-report)\//.test(file));
const deploymentExclusions = readFileSync('.vercelignore', 'utf8').split(/\r?\n/).map(line => line.trim());
const missingExclusions = ['private/', 'flow.md', 'explain.md', '.env*'].filter(entry => !deploymentExclusions.includes(entry));
if (forbidden.length || missingExclusions.length) {
  console.error(JSON.stringify({ forbiddenSourcePaths: forbidden, missingDeploymentExclusions: missingExclusions }));
  process.exit(1);
}
console.log(`Privacy path check passed for ${candidates.length} source candidates. This checks paths/exclusions; manually review contents before publishing.`);
