const async = require('async');
const fs = require('fs');
const LineByLineReader = require('line-by-line');
const Web3 = require('web3');

const argv = require('minimist')(process.argv.slice(2));

const EXPORT_DIR = argv['export-path'] || 'ethereumetl/export';
const TABLE = 'contracts';
const CSV_DIR = `${EXPORT_DIR}/${TABLE}`;

const BATCH_SIZE = argv.b || argv['batch-size'] || 100000;
const START_BLOCK = argv.s || argv['start-block'] || 0;
const END_BLOCK = argv.e || argv['end-block'] || 7532178;

const GETH_URL = argv.g || argv['geth-url'] || 'http://localhost:8545';
const web3 = new Web3(new Web3.providers.HttpProvider(GETH_URL));

const CACHE_DIR = argv['cache-dir'] || 'analysis-data';
const JSON_CACHE_PATH = `${CACHE_DIR}/json-cache.json`;

const DEBUG = argv.d || argv['debug'];
const LOG_EACH = 1;
const log = (str) => DEBUG && console.log(str);

// Max number of concurrent web3 bytecode requests
const MAX_THREADS = argv.t || argv['threads'] || 100;

// Global to be incremented by BATCH_SIZE after each async.whilst iteration
let currentBatchStartBlock = START_BLOCK;

const makeCsvPathForBatch = () => {
  const s = ('00000000' + currentBatchStartBlock).slice(-8);
  const e = ('00000000' + (currentBatchStartBlock + BATCH_SIZE - 1)).slice(-8);
  return `${CSV_DIR}/start_block\=${s}/end_block\=${e}/${TABLE}_${s}_${e}.csv`;
};

// For each pending async bytecode request, store data in this global map
let addressRequestMap = {};

const canAddThread = () => Object.keys(addressRequestMap).length < MAX_THREADS;
const queueIsFull = () => !canAddThread();
const WAIT_DELAY = 10;
const wait = (callback) => setTimeout(() => callback(null), WAIT_DELAY);

const startTime = new Date();
let totalWaitTime = 0;
let totalLineCount = 0;

// Scrape a contract CSV's contract addresses for their bytecodes
function scrapeBytecodeForCurrentBatch(callback) {
  const inputCsvPath = makeCsvPathForBatch();

  console.log('Scraping bytecodes from CSV at', inputCsvPath);
  const lineReader = new LineByLineReader(inputCsvPath);
  const cacheStream = fs.createWriteStream(JSON_CACHE_PATH);

  const batchWaitTime = 0;
  const batchLineCount = 0;

  const batchStartTime = new Date();
  const secondsSince = () => (new Date() - batchStartTime) / 1000;

  lineReader.on('line', (line) => {
    // Skip the first line
    if (++batchLineCount === 1) return;

    const lineItems = line.split(',');
    let [address, emptyBytecode, sigHashes, isErc20, isErc721] = lineItems;

    // Wait until less than MAX_THREADS concurrent web3 requests are running,
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
      // indicate that it is currently having its bytecode requested;
      // resume the line-reader; and execute the web3 bytecode request Promise
      addressRequestMap[lineItems[0]] = lineItems;
      didWait && lineReader.resume();

      // log('Running web3 bytecode request:' + address);
      waitTime = new Date();
      web3.eth.getCode(address).then(bytecode => {
        delay = new Date() - waitTime;
        log(`Bytecode#${++responseCount} (${delay}ms): ${bytecode}`);
        delete addressRequestMap[address];
        // ... do other stuff
      }).catch(console.log);
    });
  });

  lineReader.on('error', callback);

  lineReader.on('end', () => {
    totalLineCount += batchLineCount;
    totalWaitTime += batchWaitTime;

    cacheStream.end();

    // On local machine: Processed 2682461 in 281.728s
    //   with file `logs_07500000_07532178`
    //   ~10,000 lines per second
    console.log(`---SCRAPE STATES FOR BATCH ${inputCsvPath}---`);
    console.log(`  Processed ${batchLineCount} with ${batchWaitTime}ms delay`);
    console.log('TOTAL:', lineCount, 'lines in', secondsSince() + 's')
    console.log(`TOTAL: ${totalWaitTime}ms waiting to queue requests`);

    // INCREMENT currentBatchStartBlock and CALL CALLBACK
    currentBatchStartBlock += BATCH_SIZE;
    callback(null);
  });
}

const notScrapingLastBatch = () => (
  currentBatchStartBlock + BATCH_SIZE < END_BLOCK
);

async.whilst(notScrapingLastBatch, scrapeBytecodeForCurrentBatch, (err) => {
  err && console.log(err);
  console.log('-------------------------------');
  console.log(`Finished scraping block range ${START_BLOCK}-${END_BLOCK}`);
});
