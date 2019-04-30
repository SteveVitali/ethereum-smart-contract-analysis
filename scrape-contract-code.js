const async = require('async');
const fs = require('fs');
const LineByLineReader = require('line-by-line');
const Web3 = require('web3');

const argv = require('minimist')(process.argv.slice(2));

const usageStr = `
Usage: node scrape-contract-code.js [OPTIONS]

  Scrape bytecode and write a copy of the contracts data export with the
  bytecode field populated.

Options:
-t, --threads INTEGER       The number of concurrent web3.eth.getCode
                            requests to allow at a time (default 100)
-e, --export-path STRING    Location of the export directories
                            (default 'ethereumetl/export')
-o, --output-dir STRING     Location of the output directory
                            (default 'ethereumetl/export/contracts_bytecode')
-b, --batch-size INTEGER    Batch size, i.e. the number of blocks' worth of 
                            data located in each CSV (default 100,000)
-m, --max-block INTEGER     The max block number (default 7532178)
-s, --start-block INTEGER   The number block to start scraping on (default 0)
-e, --end-block INTEGER     the number block to stop scraping on
                            (defaults to the value of MAX_BLOCK)
-g, --geth-url STRING       The geth URL (default http://localhost:8545)
-d, --debug                 Turn on extra console logging
-h, --help                  Show usage and exit
`;

if (argv.h || argv['help']) {
  console.log(usageStr);
  process.exit();
}

const EXPORT_DIR = argv['export-path'] || 'ethereumetl/export';
const TABLE = 'contracts';
const CSV_DIR = `${EXPORT_DIR}/${TABLE}`;

const OUTPUT_DIR = argv['output-dir'] || `${EXPORT_DIR}/contracts_bytecode`;
const OUTPUT_TABLE = argv['output-table-name'] || 'contracts_bytecode'; 

const BATCH_SIZE = argv.b || argv['batch-size'] || 100000;
const START_BLOCK = argv.s || argv['start-block'] || 0;
const MAX_BLOCK = argv.m || argv['max-block'] || 7532178;
const END_BLOCK = argv.e || argv['end-block'] || MAX_BLOCK;

const GETH_URL = argv.g || argv['geth-url'] || 'http://localhost:8545';
const web3 = new Web3(new Web3.providers.HttpProvider(GETH_URL));

const DEBUG = argv.d || argv['debug'];
const LOG_EACH = 1;
const log = (str) => DEBUG && console.log(str);

// Max number of concurrent web3 bytecode requests
const MAX_THREADS = argv.t || argv['threads'] || 100;

// Global to be incremented by BATCH_SIZE after each async.whilst iteration
let currentBatchStartBlock = START_BLOCK;

const makeCsvPathForBatch = (dir, table) => {
  const s = ('00000000' + currentBatchStartBlock).slice(-8);
  const endBlock = Math.min(currentBatchStartBlock + BATCH_SIZE - 1, MAX_BLOCK);
  const e = ('00000000' + endBlock).slice(-8);
  return [`${dir}/start_block\=${s}/end_block\=${e}`, `${table}_${s}_${e}.csv`];
};

// For each pending async bytecode request, store data in this global map
let addressRequestMap = {};

const canAddThread = () => Object.keys(addressRequestMap).length < MAX_THREADS;
const queueIsFull = () => !canAddThread();
const queueIsNonEmpty = () => Object.keys(addressRequestMap).length > 0;
const WAIT_DELAY = 10;

const wait = (callback) => setTimeout(() => callback(null), WAIT_DELAY);

const startTime = new Date();
let totalWaitTime = 0;
let totalLineCount = 0;

// Scrape a contract CSV's contract addresses for their bytecodes
function scrapeBytecodeForCurrentBatch(callback) {
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
  console.log('Scraping bytecodes from CSV at', inPath);
  console.log('Writing new CSV with bytecode to', outPath);

  const lineReader = new LineByLineReader(inPath);
  const csvWriter = fs.createWriteStream(outPath, { flags:'a' });

  let batchWaitTime = 0;
  let batchLineCount = 0;

  const batchStartTime = new Date();
  const secondsSince = () => (new Date() - batchStartTime) / 1000;

  lineReader.on('line', (line) => {
    // Skip the first line
    if (++batchLineCount === 1) {
      return csvWriter.write(line + '\n'); 
    };

    const lineItems = line.split(',');
    let [address, emptyBytecode, sigHashes, isErc20, isErc721] = lineItems;

    // Wait until less than MAX_THREADS concurrent web3 requests are running,
    const didWait = !canAddThread();
    if (didWait) {
      lineReader.pause();
      // log('Pausing line reader at line', batchLineCount);
    }

    let waitTime = new Date();

    async.whilst(queueIsFull, wait, (err) => {
      let delay = new Date() - waitTime;
      batchWaitTime += delay;
      // didWait && console.log('Waited', delay, 'ms');

      // Add current contract lineItems to the addressRequestMap map to
      // indicate that it is currently having its bytecode requested;
      // resume the line-reader; and execute the web3 bytecode request Promise
      addressRequestMap[lineItems[0]] = lineItems;
      didWait && lineReader.resume();

      // log('Running web3 bytecode request:' + address);
      // waitTime = new Date();
      web3.eth.getCode(address).then(bytecode => {
        // delay = new Date() - waitTime;
        // bytecode !== '0x' && log('Bytecode: ' + bytecode);

        // Delete contract address from map since its bytecode has been scraped
        delete addressRequestMap[address];

        // Write the new line of scraped bytecode to the output CSV
        const outLine = [address, bytecode, sigHashes, isErc20, isErc721];
        csvWriter.write(outLine.join(',') + '\n');

      }).catch(console.log);
    });
  });

  lineReader.on('end', () => {
    // Wait for queue to empty, since end of input CSV may be read before
    // all the updated bytecodes are written to output, which means we must
    // wait to close the output stream    
    const startWait = new Date();
    async.whilst(queueIsNonEmpty, wait, (err) => {
      err && console.log(err);
      console.log('Waited', new Date() - startWait, 'ms for queue to empty');
      
      csvWriter.end();

      totalLineCount += batchLineCount;
      totalWaitTime += batchWaitTime;

      // On local machine: Processed 2682461 in 281.728s
      //   with file 'logs_07500000_07532178'
      //   ~10,000 lines per second
      const end = currentBatchStartBlock + BATCH_SIZE - 1;
      console.log('SCRAPE STATS FOR BATCH' + currentBatchStartBlock + '-' + end);
      console.log('Processed', batchLineCount, 'with', batchWaitTime + 'ms delay');
      console.log(totalLineCount, secondsSince(), totalWaitTime); 

      // INCREMENT currentBatchStartBlock and CALL CALLBACK
      currentBatchStartBlock += BATCH_SIZE;
      callback(null);
    });
  });

  lineReader.on('error', callback);
}


const notFinishedScrapingLastBatch = () => (
  currentBatchStartBlock <= END_BLOCK
);

// Scrape each batch and write it to new file
// Note: after each async scrapeBytecodeForCurrrentBatch call,
// currentBatchStartBlock is incremented by BATCH_SIZE
async.whilst(notFinishedScrapingLastBatch, scrapeBytecodeForCurrentBatch, (err) => {
  err && console.log(err);
  console.log('-------------------------------');
  console.log('Finished scraping block range' + START_BLOCK + '-' + END_BLOCK);
});

