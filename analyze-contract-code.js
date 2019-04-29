const async = require('async');
const fs = require('fs');
const LineByLineReader = require('line-by-line');
const csvHeaders = require('./csv-headers.js');

const argv = require('minimist')(process.argv.slice(2));

const PythonShell = require('python-shell').PythonShell;
const PYTHON_PATH = argv['python-path'] || '/usr/bin/python';
const OYENTE_PY_PATH = argv['oyente-path'] || './oyente/oyente/oyente.py';
const OYENTE_PY_DIR = 'oyente/oyente';

const EXPORT_DIR = argv['export-path'] || 'ethereumetl/export';
const TABLE = 'contracts_bytecode';
const CSV_DIR = `${EXPORT_DIR}/${TABLE}`;

const OUTPUT_DIR = argv['output-dir'] || `${EXPORT_DIR}/contracts_analysis`;
const OUTPUT_TABLE = argv['output-table-name'] || 'contracts_analysis'; 

const OUTPUT_HEADER = csvHeaders.contracts_analysis;

const BATCH_SIZE = argv.b || argv['batch-size'] || 100000;
const START_BLOCK = argv.s || argv['start-block'] || 0;
const MAX_BLOCK = argv.m || argv['max-block'] || 7532178;
const END_BLOCK = argv.e || argv['end-block'] || MAX_BLOCK;

const DEBUG = argv.d || argv['debug'];
const LOG_EVERY = argv.l || argv['log-every'] || 1;
const log = (str) => DEBUG && console.log(str);

// Max number of concurrent oyente Python threads
const MAX_THREADS = argv.t || argv['threads'] || 4;

// Global to be incremented by BATCH_SIZE after each async.whilst iteration
let currentBatchStartBlock = START_BLOCK;

const makeCsvPathForBatch = (dir, table) => {
  const s = ('00000000' + currentBatchStartBlock).slice(-8);
  const endBlock = Math.min(currentBatchStartBlock + BATCH_SIZE - 1, MAX_BLOCK);
  const e = ('00000000' + endBlock).slice(-8);
  return [`${dir}/start_block\=${s}/end_block\=${e}`, `${table}_${s}_${e}.csv`];
};

// For each pending oyente bytecode analysis, store data in this global map
let addressRequestMap = {};

const numActiveThreads = () => Object.keys(addressRequestMap).length;
const canAddThread = () => numActiveThreads() < MAX_THREADS;
const queueIsNonEmpty = () => numActiveThreads()  > 0;
const queueIsFull = () => !canAddThread();

const WAIT_DELAY = 10;
const wait = (callback) => setTimeout(() => callback(null), WAIT_DELAY);

// Init stats variables
let totalTotalTime = 0;
let totalWaitTime = 0;
let totalOyenteTime = 0;
let totalLineCount = 0;
let totalEmptyCount = 0;
let totalErrorCount = 0;

// Launch an oyente analysis of contract at address `address` with EVM
// bytecode `bytecode`; when complete, send Json result to callback `done`
const launchOyenteThread = (address, bytecode, done) => {
  // Write the bytecode to a temporary file <contract-address>.evm for oyente
  // Note: we slice the first two characters of the bytecode '0x'
  const byteCodePath = `${address}.evm`;
  const evmCode = bytecode.slice(2);

  if (evmCode.length === 0) {
    totalEmptyCount += 1;
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

// Scrape a contract CSV's contract addresses for their bytecodes
function analyzeBytecodesForCurrentBatch(callback) {
  const [inputDir, inputFile] = makeCsvPathForBatch(CSV_DIR, TABLE);
  const [outputDir, outputFile] = makeCsvPathForBatch(OUTPUT_DIR, OUTPUT_TABLE);
  const inPath = `${inputDir}/${inputFile}`;
  const outPath = `${outputDir}/${outputFile}`;

  if (fs.existsSync(outPath)) {
    console.log('SKIPPING BATCH: output already written to', outPath);
    currentBatchStartBlock += BATCH_SIZE;
    return callback(null);
  }
  else {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  console.log('___________________________________________');
  console.log('Analyzing bytecodes from CSV at', inPath);
  console.log('Writing new CSV with bytecode analysis to', outPath);

  const lineReader = new LineByLineReader(inPath);
  const csvWriter = fs.createWriteStream(outPath, { flags:'a' });

  let batchWaitTime = 0;
  let batchOyenteTime = 0;
  let batchLineCount = 0;
  let batchErrorCount = 0;
  let batchTotalTime = 0;
  const batchStartTime = new Date();

  lineReader.on('line', (line) => {
    // Skip the first line, but write the header to the output Csv
    if (batchLineCount === 0) {
      batchLineCount += 1;
      return csvWriter.write(OUTPUT_HEADER + '\n'); 
    };

    const lineItems = line.split(',');
    let [address, bytecode, sigHashes, isErc20, isErc721] = lineItems;

    // Wait until less than MAX_THREADS concurrent oyente threads are running,
    const didWait = !canAddThread();
    if (didWait) lineReader.pause();

    let waitTime = new Date();

    async.whilst(queueIsFull, wait, (err) => {
      // Add current contract lineItems to the addressRequestMap map to
      // indicate that it is currently having its bytecode analyzed;
      // resume the line-reader; and execute the oyente bytecode analysis
      addressRequestMap[lineItems[0]] = lineItems;
      didWait && lineReader.resume();

      const waitDelay = new Date() - waitTime;
      const startOyente = new Date();

      launchOyenteThread(address, bytecode, (err, jsonResult) => {
        jsonResult = jsonResult || {};
        jsonResult.vulnerabilities = jsonResult.vulnerabilities || {};
        jsonResult.evm_code_coverage = jsonResult.evm_code_coverage || '';
        ['callstack', 'reentrancy', 'time_dependency', 'integer_overflow',
          'integer_underflow', 'money_concurrency'].forEach(vulnerability => {
          jsonResult.vulnerabilities[vulnerability] = (
            jsonResult.vulnerabilities[vulnerability] !== undefined
              ? jsonResult.vulnerabilities[vulnerability]
              : ''
          );
        });

        jsonResult.oyente_err = !!err;
        if (err) {
          console.log('OYENTE ERR:', err);
          batchErrorCount += 1;
        }

        // Write the new line of scraped bytecode to the output CSV
        let { vulnerabilities, evm_code_coverage, oyente_err } = jsonResult;
        let { callstack, reentrancy, time_dependency, integer_overflow,
              integer_underflow, money_concurrency } = vulnerabilities;

        // Write oyente results to output CSV
        csvWriter.write(
          [ address, bytecode, sigHashes, isErc20, isErc721, callstack,
            reentrancy, time_dependency, integer_overflow, integer_underflow,
            money_concurrency, evm_code_coverage, oyente_err].join(',') + '\n',
          (err) => {
            err && console.log(err);
            // Delete contract address from map since its bytecode was analyzed
            delete addressRequestMap[address];

            const oyenteDelay = (new Date()) - startOyente;
            batchWaitTime += waitDelay;
            batchOyenteTime += oyenteDelay;
            batchTotalTime += (new Date()) - batchStartTime;
            batchLineCount += 1;

            if (batchLineCount % LOG_EVERY === 0) {
              console.log(`[${batchLineCount}] Ran oyente ${oyenteDelay}ms, ` +
                `waited ${waitDelay}ms, ${numActiveThreads()} threads`);
            }
          }
        );
      });
    });
  });

  lineReader.on('end', () => {
    // Wait for queue to empty, since end of input CSV may be read before
    // all the updated bytecode analyses are written to output,
    // which means we must wait to close the output stream    
    console.log('Reached end of file; waiting on', numActiveThreads());
    const startWait = new Date();
    async.whilst(queueIsNonEmpty, wait, (err) => {
      err && console.log(err);
      console.log('Waited', new Date() - startWait, 'ms for queue to empty');
      console.log('Now safely closing the output stream');
      csvWriter.end();

      totalLineCount += batchLineCount;
      totalTotalTime += batchTotalTime;
      totalWaitTime += batchWaitTime;
      totalOyenteTime += batchOyenteTime;
      totalErrorCount += batchErrorCount;

      const end = currentBatchStartBlock + BATCH_SIZE - 1;

      console.log(`__STATS FOR BATCH ${currentBatchStartBlock}-${end}__`);
      console.log(`  ${batchLineCount} lines, ${batchErrorCount} errors`);
      console.log(`  ${batchOyenteTime / 1000}s oyente time`);
      console.log(`  ${batchWaitTime / 1000}s queue wait time`);
      console.log(`  ${batchTotalTime / 1000}s batch total`);
      console.log();
      console.log('__AGGREGATE STATS__');
      console.log('Total time', (totalTotalTime / 1000), 'seconds');
      console.log('Total lines', totalLineCount);
      console.log('Total queue wait', totalWaitTime);
      console.log('Total oyente time', totalOyenteTime);
      console.log('Total errors', totalErrorCount); 

      // INCREMENT currentBatchStartBlock and CALL CALLBACK
      currentBatchStartBlock += BATCH_SIZE;
      callback(null);
    });
  });

  lineReader.on('error', callback);
}


const notFinishedLastBatch = () => (
  currentBatchStartBlock <= END_BLOCK
);

// Analyze each batch and write results to new file
// Note: after each async analyzeBytecodesForCurrrentBatch call,
// currentBatchStartBlock is incremented by BATCH_SIZE
async.whilst(notFinishedLastBatch, analyzeBytecodesForCurrentBatch, (err) => {
  err && console.log(err);
  console.log('-------------------------------');
  console.log('Finished scraping block range' + START_BLOCK + '-' + END_BLOCK);
});
