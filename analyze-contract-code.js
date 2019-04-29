const async = require('async');
const fs = require('fs');
const LineByLineReader = require('line-by-line');
const csvHeaders = require('csv-headers');

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

const OUTPUT_HEADER = csvHeaders.contracts_analysis.join(',');

const BATCH_SIZE = argv.b || argv['batch-size'] || 100000;
const START_BLOCK = argv.s || argv['start-block'] || 0;
const MAX_BLOCK = argv.m || argv['max-block'] || 7532178;
const END_BLOCK = argv.e || argv['end-block'] || MAX_BLOCK;

const DEBUG = argv.d || argv['debug'];
const LOG_EACH = 1;
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

const canAddThread = () => Object.keys(addressRequestMap).length < MAX_THREADS;
const queueIsFull = () => !canAddThread();
const queueIsNonEmpty = () => Object.keys(addressRequestMap).length > 0;
const WAIT_DELAY = 10;

const wait = (callback) => setTimeout(() => callback(null), WAIT_DELAY);

const startTime = new Date();
let totalWaitTime = 0;
let totalLineCount = 0;

// Launch an oyente analysis of contract at address `address` with EVM
// bytecode `bytecode`; when complete, send Json result to callback `done`
const launchOyenteThread = (address, bytecode, done) => {
  // Write the bytecode to a temporary file <contract-address>.evm for oyente
  const byteCodePath = `${address}.evm`;
  fs.writeFile(byteCodePath, bytecode, (err) => {
    if (err) return done(err);

    let shell = new PythonShell('oyente.py', {
      pythonPath: PYTHON_PATH,
      scriptPath: OYENTE_PY_DIR,
      args: ['-s', byteCodePath, '-b']
    });

    let jsonResult = '';
    shell.on('message', message => jsonResult += message);
    shell.on('stderr', err => done(err));
    shell.on('error', err => done(err));
    shell.on('close', () => {
      // Delete temporary bytecode file and return Json result
      fs.unlink(byteCodePath, err => done(err, JSON.parse(jsonResult)));
    });
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
  let batchLineCount = 0;
  const batchStartTime = new Date();
  const secondsSince = () => (new Date() - batchStartTime) / 1000;

  lineReader.on('line', (line) => {
    // Skip the first line, but write the header to the output Csv
    if (++batchLineCount === 1) {
      return csvWriter.write(OUTPUT_HEADER + '\n'); 
    };

    const lineItems = line.split(',');
    let [address, bytecode, sigHashes, isErc20, isErc721] = lineItems;

    // Wait until less than MAX_THREADS concurrent oyente threads are running,
    const didWait = !canAddThread();
    if (didWait) {
      lineReader.pause();
      log('Pausing line reader at line', batchLineCount);
    }

    let waitTime = new Date();

    async.whilst(queueIsFull, wait, (err) => {
      let delay = new Date() - waitTime;
      batchWaitTime += delay;
      didWait && console.log('Waited', delay, 'ms');

      // Add current contract lineItems to the addressRequestMap map to
      // indicate that it is currently having its bytecode analyzed;
      // resume the line-reader; and execute the oyente bytecode analysis
      addressRequestMap[lineItems[0]] = lineItems;
      didWait && lineReader.resume();


      log('Running oyente bytecode analysis for contract:' + address);
      waitTime = new Date();
      launchOyenteThread(address, bytecode, (err, jsonResult) => {
        log('result', jsonResult, 'delay', new Date() - waitTime);

        // Delete contract address from map since its bytecode was analyzed
        delete addressRequestMap[address];

        // Write the new line of scraped bytecode to the output CSV
        let { vulnerabilities, evm_code_coverage } = jsonResult;

        let { callstack, reentrancy, time_dependency, integer_overflow,
              integer_underflow, money_concurrency } = vulnerabilities;

        // Write oyente results to output CSV
        csvWriter.write([
          address, bytecode, sigHashes, isErc20, isErc721,
          callstack, reentrancy, time_dependency, integer_overflow,
          integer_underflow, money_concurrency
        ].join(',') + '\n');

      }).catch(console.log);
    });
  });

  lineReader.on('end', () => {
    // Wait for queue to empty, since end of input CSV may be read before
    // all the updated bytecode analyses are written to output,
    // which means we must wait to close the output stream    
    const startWait = new Date();
    async.whilst(queueIsNonEmpty, wait, (err) => {
      err && console.log(err);
      console.log('Waited', new Date() - startWait, 'ms for queue to empty');

      csvWriter.end();

      totalLineCount += batchLineCount;
      totalWaitTime += batchWaitTime;

      const end = currentBatchStartBlock + BATCH_SIZE - 1;
      console.log('SCRAPE STATS FOR BATCH' + currentBatchStartBlock + '-' + end);
      console.log('Analyzed', batchLineCount, 'with', batchWaitTime + 'ms delay');
      console.log(totalLineCount, secondsSince(), totalWaitTime); 

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
