import fs from 'fs';
import readLine from 'readline';
import Web3 from 'web3';

const GETH_URL = 'http://localhost:8545';
const web3 = new Web3(new Web3.providers.HttpProvider(GETH_URL));

const INPUT_CSV_PATH = '../example-csvs/logs_07500000_07532178.csv';
const JSON_CACHE_PATH = '../analysis-data/json-cache.json';

const dataStream = fs.createReadStream(INPUT_CSV_PATH);
const lineReader = readLine.createInterface(dataStream);

const cacheStream = fs.createWriteStream(JSON_CACHE_PATH);

const startTime = new Date();
const secondsSince = () => (new Date() - startTime) / 1000;

let lineCount = 0;

lineReader.on('line', (line) => {
  // process line
  lineCount += 1;
  if (lineCount % 10000 === 0) {
  	console.log('Processed', lineCount, 'in', secondsSince() + 's');
  }
});

lineReader.on('close', () => {
  cacheStream.end();

  // On local machine: Processed 2682461 in 281.728s
  //   with file `logs_07500000_07532178`
  //   ~10,000 lines per second
  console.log('Processed', lineCount, 'in', secondsSince() + 's');
});
