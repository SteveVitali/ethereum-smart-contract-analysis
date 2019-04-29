const spawn = require('child_process').spawn;

const argv = require('minimist')(process.argv.slice(2));

const PYTHON_PATH = argv['python-path'] || '/usr/bin/python';
const OYENTE_PY_PATH = argv['oyente-path'] || './oyente/oyente/oyente.py';
const OYENTE_PY_DIR = 'oyente/oyente';

const byteCodePath = './ex.evm';

const PythonShell = require('python-shell').PythonShell;

const options = {
  mode: 'text',
  pythonPath: PYTHON_PATH,
  scriptPath: OYENTE_PY_DIR,
  args: ['-s', byteCodePath, '-b']
};


PythonShell.run('oyente.py', options, function (err, results) {
  err && console.log(err);
  console.log('results', results);
});

/*
let shell = new PythonShell('oyente.py', options);
shell.on('message', message => console.log('message', message));
shell.on('stderr', err => console.log(err));
shell.on('error', err => console.log(err));
shell.on('close', () => console.log('terminated'));
*/

