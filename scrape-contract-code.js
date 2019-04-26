const async = require('async');
const fs = require('fs');
const LineByLineReader = require('line-by-line');
const Web3 = require('web3');

const GETH_URL = 'http://localhost:8545';
const web3 = new Web3(new Web3.providers.HttpProvider(GETH_URL));

const EXPORT_DIR = 'ethereumetl/export';
const TABLE = 'contracts';
const CSV_DIR = `${EXPORT_DIR}/${TABLE}`;

const BATCH_SIZE = 100000;
const START_BLOCK = 0;
let currentBatchStartBlock = START_BLOCK;

const makeCsvPathForBatch = () => {
  const s = ('00000000' + currentBatchStartBlock).slice(-8);
  const e = ('00000000' + (currentBatchStartBlock + BATCH_SIZE - 1)).slice(-8);
  return `${CSV_DIR}/start_block\=${s}/end_block\=${e}/${TABLE}_${s}_${e}.csv`;
};

const INPUT_CSV_PATH = makeCsvPathForBatch();

const JSON_CACHE_PATH = './analysis-data/json-cache.json';

const LOG_EACH = 1;

// Max number of concurrent web3 bytecode requests
const MAX_THREADS = 100;

// For each pending async bytecode request, store data here
let addressRequestMap = {};

// const dataStream = fs.createReadStream(INPUT_CSV_PATH);
const lineReader = new LineByLineReader(INPUT_CSV_PATH);
const cacheStream = fs.createWriteStream(JSON_CACHE_PATH);

const canAddThread = () => Object.keys(addressRequestMap).length < MAX_THREADS;
const queueIsFull = () => !canAddThread();
const WAIT_DELAY = 10;
const wait = (callback) => setTimeout(() => callback(null), WAIT_DELAY);

let totalWaitTime = 0;
let lineCount = 0;
let responseCount = 0;

const startTime = new Date();
const secondsSince = () => (new Date() - startTime) / 1000;


lineReader.on('error', (err) => console.log(err));


lineReader.on('line', (line) => {
  // Skip the first line
  if (++lineCount === 1) return;

  const lineItems = line.split(',');
  let [address, emptyBytecode, sigHashes, isErc20, isErc721] = lineItems;

  // Wait until less than MAX_THREADS concurrent web3 requests are running,
  const didWait = !canAddThread();
  if (didWait) {
    lineReader.pause();
    console.log('Pausing line reader at ' + lineCount + ' until space opens');
  }

  let waitTime = new Date();
  async.whilst(queueIsFull, wait, (err) => {
    let delay = new Date() - waitTime;
    totalWaitTime += delay;
    if (didWait) console.log('Waited', delay, 'out of', totalWaitTime);

    // Add current contract lineItems to the addressRequestMap map to
    // indicate that it is currently having its bytecode requested;
    // resume the line-reader; and execute the web3 bytecode request Promise
    addressRequestMap[lineItems[0]] = lineItems;
    if (didWait) {
      lineReader.resume();
      console.log('resuming reader');
    }

    console.log('Running web3 bytecode request:' + address);
    waitTime = new Date();
    web3.eth.getCode(address).then((bytecode) => {
      delay = new Date() - waitTime;
      console.log(`Bytecode#${++responseCount} (${delay}ms): ${bytecode}`);
      delete addressRequestMap[address];
      // ... do other stuff
      //
    })
    .catch((err) => console.log('ERROR FETCHING BYTECODE', err));
  });
});


lineReader.on('end', () => {
  cacheStream.end();
  // On local machine: Processed 2682461 in 281.728s
  //   with file `logs_07500000_07532178`
  //   ~10,000 lines per second
  console.log('Processed', lineCount, 'in', secondsSince() + 's')
  console.log(`Spent total of ${totalWaitTime}ms waiting to queue requests`);
});

