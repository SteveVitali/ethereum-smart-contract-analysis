const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const PythonShell = require('python-shell').PythonShell;
const PYTHON_PATH = '/usr/bin/python';
const OYENTE_PY_DIR = 'oyente/oyente';

const { address, bytecode, MAX_THREADS } = workerData;

// Launch an oyente analysis of contract at address `address` with EVM
// bytecode `bytecode`; when complete, send Json result to callback `done`
const launchOyenteThread = (address, bytecode, done) => {
  // Write the bytecode to a temporary file <contract-address>.evm for oyente
  // Note: we slice the first two characters of the bytecode '0x'
  const byteCodePath = `${address}.evm`;
  const evmCode = bytecode.slice(2);

  if (evmCode.length === 0) {
    // log('Empty bytecode for address ' + address);
    return done(null, { vulnerabilities: {} });
  }

  fs.writeFile(byteCodePath, evmCode, (err) => {
    if (err) return done(err);

    // Progressively append str result to this string on 'message' events
    let jsonResult = '';

    // Avoid 'close' and 'stderror' events both calling onDone callback
    let isDone = false;

    // Callback to delete temporary bytecode file and return Json result
    const onDone = (err) => {
      if (isDone) return;
      else isDone = true;
      jsonResult = jsonResult.length > 0 ? jsonResult : '{}';
      fs.unlink(byteCodePath, e => done(err, JSON.parse(jsonResult)));
    };

    // Init the python shell to run oyente on this contract and handle events
    let shell = new PythonShell('oyente.py', {
      pythonPath: PYTHON_PATH,
      scriptPath: OYENTE_PY_DIR,
      args: ['-s', byteCodePath, '-b']
    });

    shell.on('message', message => jsonResult += message);
    shell.on('stderr', err => {
      if (err.slice(0, 4) == 'INFO') return;
      else return onDone(err);
    });
    // Assume all errors will be handled by stderr above
    shell.on('error', err => {});
    shell.on('close', onDone);

  });
};

// console.log('launching oyente thread with address', address);
launchOyenteThread(address, bytecode, (err, result) => {
  parentPort.postMessage({ err, result });
});

