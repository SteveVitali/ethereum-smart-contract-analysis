const fs = require('fs');
const readLine = require('readline');
const Web3 = require('web3');

const GETH_URL = 'http://localhost:8545';
const web3 = new Web3(new Web3.providers.HttpProvider(GETH_URL));

const INPUT_CSV_PATH = './ethereumetl/export/logs/start_block=07500000/end_block=07532178/logs_07500000_07532178.csv';
const JSON_CACHE_PATH = './analysis-data/json-cache.json';

const LOG_EACH = 1;

const dataStream = fs.createReadStream(INPUT_CSV_PATH);
const lineReader = readLine.createInterface(dataStream);

const cacheStream = fs.createWriteStream(JSON_CACHE_PATH);

const startTime = new Date();
const secondsSince = () => (new Date() - startTime) / 1000;

let lineCount = 0;

lineReader.on('line', (line) => {
  // process line

  lineCount += 1;
  if (lineCount % LOG_EACH === 0) {
    console.log('Processed', lineCount, 'in', secondsSince() + 's');
  }
});

lineReader.on('close', () => {
  cacheStream.end();

  // On local machine: Processed 2682461 in 281.728s
  //   with file `logs_07500000_07532178` (~1.3GB)
  //   ~10,000 lines per second
  // On EC2 t2.large: Processed 2682461 in 46.948s
  //   57k lines/sec; ~36sec/GB ==> ~4.5hr for 450
  console.log('Processed', lineCount, 'in', secondsSince() + 's');
});

