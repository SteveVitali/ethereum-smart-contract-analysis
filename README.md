# ethereum-smart-contract-analysis

# Scraping the Blockchain and Exporting to S3 -- EC2 Setup Instructions

(Instructions adapted from Evgeny Medvedev's [helpful Medium post](https://medium.com/@medvedev1088/exporting-and-analyzing-ethereum-blockchain-f5353414a94e))

SSH into EC2 instance
```
ssh -i "<path-to-key.pem>" ubuntu@<public-dns-name>
```

Install [geth (go-ethereum)](https://github.com/ethereum/go-ethereum/wiki/Installation-Instructions-for-Ubuntu):
```
> sudo apt-get install software-properties-common
> sudo add-apt-repository -y ppa:ethereum/ethereum
> sudo apt-get update
> sudo apt-get install ethereum
> geth account new
```

Start geth
```
> nohup geth --cache=1024 &
```

Clone Ethereum ETL (my fork) and install dependencies

```
> git clone https://github.com/SteveVitali/ethereum-etl.git
> cd ethereum-etl
> sudo apt-get install python3-pip
> sudo pip3 install -e .
```

Run `export_all.sh`

```
> START_BLOCK=0
> END_BLOCK=7481338
> nohup bash export_all.sh -s $START_BLOCK -e $END_BLOCK -b 100000 -p file://$HOME/.ethereum/geth.ipc -o output &
```

NOTE: as per the requirements of `ethereum-etl`, the export script will not run unless a version of Python satisfying `>=3.5.3,<3.8.0` is installed. So, be sure to install a version in that range first (the default on AWS EC2 Ubuntu 16.04 is Python 3.5.2). Instructions [here](http://ubuntuhandbook.org/index.php/2017/07/install-python-3-6-1-in-ubuntu-16-04-lts/):

```
sudo add-apt-repository ppa:jonathonf/python-3.6
sudo apt-get update
sudo apt-get install python3.6
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.5 1
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.6 2
```
Use `update-alternatives` to toggle the `python3` command between version 3.5 and 3.6:
```
sudo update-alternatives --config python3
```

After checking with `python3 -V` that 3.6 is installed (at the time of writing, 3.6.7), there will likely still be more errors. Hopefully these errors, too, will go away once the `python-dev` package is installed (this makes all the header files accessible, among other things, which is necessary for some reason to install `web3`, among other requirements...):
```
sudo apt-get install python3.6-dev
```

Finally, run:
```
sudo -H pip3 install -e .
```

At this point, the `export_all.sh` script above should be able to start executing without errors, in which case `/output` will begin to be populated by the exported Ethereum data.

If there is *still* an error, this is probably because `geth` has not fully synced up to the specified `$START_BLOCK`. If this is the case, you will need to wait. You can check the status of the syncing by running `geth attach` and in the JS console entering:
```
>eth.syncing
```
Which should return an object of the form:
```
{
  currentBlock: 1000000,
  highestBlock: 7526118,
  knownStates: 97867404,
  pulledStates: 97855918,
  startingBlock: 0
}
```
If it returns `false`, you probably just have to wait a short period before syncing starts.


Now, finally, once `export_all.sh` is successfully run, it will begin populating `/output`, which should contain these sub-directories:

```
blocks              contracts  receipts         token_transfers  transaction_hashes
contract_addresses  logs       token_addresses  tokens           transactions
```

Each of these (e.g. `/blocks`) should contain results of the form:

```
/start_block=00000000/end_block=00099999/blocks_00000000_00099999.csv
/start_block=00100000/end_block=00199999/blocks_00100000_00199999.csv
...
/start_block=<$END_BLOCK-100000>/end_block=<$END_BLOCK>/blocks_<$END_BLOCK-100000>_<$END_BLOCK-100000>.csv
```

Now, create a new S3 bucket in the [Amazon S3 console](https://console.aws.amazon.com/s3/home) and make sure permissions for the EC2 instances are granted.

Make sure the [AWS CLI](https://aws.amazon.com/cli) is installed:
```
sudo pip3 install awscli
```

Run `aws configure` (if necessary, generate new access/secret keys in the [IAM console](https://console.aws.amazon.com/iam/home))

Finally, sync the files to S3:
```
> cd output
> aws s3 sync . s3://<your_bucket>/ethereumetl/export
```

If you get an error of the form "'AWSHTTPSConnection' object has no attribute...", try uninstalling and re-installing `request` to version 2.12 as suggested [here](https://github.com/boto/botocore/issues/1258) by `mha6`:
```
> pip3 uninstall requests
> pip3 install requests==2.12
```

You may also get an error about the `gdbm` module. In this case, try installing `gdbm` for Python 3.6 in particular:
```
sudo apt-get install python3.6-gdbm
```

At this point, with the contents of `/output` synced to S3, Medvedev suggests converting Ethereum ETL files to Parquet for much faster querying. For now, we'll skip this step.

To check progress of each sub-directory run:
```
(echo "blocks" && ls blocks &&
echo "transactions" && ls transactions &&
echo "token_transfers" && ls token_transfers &&
echo "transaction_hashes" && ls transaction_hashes &&
echo "receipts" && ls receipts &&
echo "logs" && ls logs &&
echo "contract_addresses" && ls contract_addresses &&
echo "token_addresses" && ls token_addresses &&
echo "contracts" && ls contracts &&
df -h &&
echo "SCRAPING BLOCK RANGE: $START_BLOCK-$END_BLOCK")
```
(alternatively, run the `scrape-status.sh` helper script, but remember to `export START_BLOCK` and `export END_BLOCK` first)


Now, create a new database in [AWS Athena](https://console.aws.amazon.com/athena/home):
```
CREATE DATABASE ethereumetl;
```

Create tables for blocks, transactions, etc. by running the SQL located in `schemas/blocks.sql`, `schemas/contracts.sql`, et cetera.

Now we can try a sanity check, e.g.:
```
select count(*) from transactions; # ~7,500,000
```

------

# Manual Analysis with node.js

## EC2 Setup Instructions

- Spin up a new Amazon EC2 instance. Make sure that there is enough disk space; a good lower bound is the sum of the [size of a fast `geth` sync](https://etherscan.io/chart2/chaindatasizefast) (now about 135GB) plus the size of the S3 bucket with the exported CSV's (now about 450GB).
	- E.g., spin up a `t2.large` instance of Ubuntu Server 16.04 LTS (HVM) with an EBS volume of 800 GiB

- First clone the main project repository and cd into it, since all of what follows will be done from within that directory:
```
> git clone https://github.com/SteveVitali/ethereum-smart-contract-analysis.git
> cd ethereum-smart-contract-analysis
```

- Run `bash setup-ec2-scraper.sh` to configure/install everything (note: it may take several hours for `geth` to re-sync)

- Copy the entire 450+GB S3 bucket to the single EC2 instance using AWS command line interface (note: ec2 instance must have permissions for bucket, or it must be public) E.g., run:
```
aws s3 sync s3://ethereum-blockchain-analysis-svitali .
```
NOTE: this may take a long time, possibly a few hours, depending on the level of EC2 instance deployed.

(You may also need to install the Python 3.6 specific version of `gdbm`: `sudo apt-get install python3.6-gdbm`)

Once the export is complete, running `du --summary --human-readable *`) from `ethereumetl/export` should return something approximating this (at the time of writing, END_BLOCK=7532178):
```
7.6G	blocks
502M	contract_addresses
141M	contracts
146G	logs
69G	receipts
14M	token_addresses
5.6M	tokens
42G	token_transfers
27G	transaction_hashes
161G	transactions
```

If you haven't already, also install `npm` and the repo's package.json requirements:
```
sudo apt install npm
npm install
```

If the `npm install` still causes errors (e.g., an ENOENT error), you may need to install `node-gyp` first:
```
sudo npm install -g node-gyp
```

If the install still fails, you may need to [update your node version](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-up-node-on-ec2-instance.html):
```
# Install nvm
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.32.0/install.sh | bash

# Activate nvm
. ~/.nvm/nvm.sh

# Install
nvm install 10.15.3

# Sanity check
node -e "console.log('Running Node.js ' + process.version)"
```

At this point, the `npm install` should succeed, and we should be able to run our node scripts without error.

## Scraping and Exporting the Contract Bytecodes

You may notice that in the CSV's exported to `/contracts`, the second `bytecode` field is always '0x' for all contracts. If this is not the case for you, then congratulations. As it turns out, the state synchronization which contains the contract bytecode actually occurs after the basic level of synchronization that was required for the Ethereum-etl `export_all.sh` script to succeed. What this means is that the RPC request `eth_getCode` returned `0x` for all of the contracts we scraped and exported in the first step.

Basically what this means is that you may need to wait up to several days for this state synchronization to complete and then run our bytecode scraper script to fetch the bytecodes for each of the contract addresses and write the results to a new directory of CSV's.

To check that the state synchronization has completed, try running `geth attach` and from the node console testing `eth.getCode` on some contract addresses:
```
> eth.getCode('<contract_address>')
```
If the responses are not '0x', then the state sync has probably completed.

Another possible reason that all the scraped bytecodes from Ethereum-etl's `export_all.sh` returned '0x' is that in Medvedev's original tutorial, he forgot to include the `--rpc` flag on `geth` startup, which means that some (or all?) of the RPC calls made during the export script succeeded. For this reason we have updated our EC2 setup script to run:
```
nohup geth --cache=1024 --rpc --rpcport "8545" --rpcaddr "127.0.0.1" &
```

Now, once RPC is explicitly enabled, and once the state sync has completed, calls to `eth.getCode` should return actual bytecode hexes.


### Running the `scrape-contract-code.js` Script

To scrape a block range of contract bytecodes and write the results to a new directory `contract_bytecodes`, run:
```
node scrape-contract-code.js -s <start_block> -e <end_block>
```

This script reads every line of every CSV located in `ethereumetl/export/contracts`, fetches the otherwise-empty bytecode for each contract line using `web3.eth.getCode` RPC call, and then writes the results to parallel CSV's in a new directory `contracts_bytecode`, which has completely identical contents to `contracts/`, except that the bytecodes are now filled in.

```
Usage: node scrape-contract-code.js [OPTIONS]

  Scrape bytecode and write a copy of the contracts data export with the bytecode field populated.

Options:
  -t, --threads INTEGER       The number of concurrent `web3.eth.getCode`
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
  -g, --geth-url STRING       The geth URL (default `http://localhost:8545`)
  -d, --debug                 Turn on extra console logging
  -h, --help                  Show usage and exit
```

Once `scrape-contract-code.js` is done executing, you may want to sync the results to the S3 data store:
```
> cd ethereumetl/export
> aws s3 sync . s3://<bucket_name>/ethereumetl/export
```
If you want, you could even just delete the old `contracts` directory and rename `contracts_bytecode` to `contracts`. In any case, at this point the way is paved for running direct analyses (e.g., with Oyente) on the contract bytecodes themselves.


## Setting up Oyente
Install basics for Python 2.x in case they are not installed already
```
sudo apt-get install python
sudo apt install python-pip
pip install virtualenv
```

Start Python Virtualesbinv
```
python -m virtualenv env
source env/bin/activate
```

Install Oyente (my fork)
```
git clone https://github.com/SteveVitali/oyente.git
```

### Install solidity v0.4.17
Use `wget` to copy v0.4.17 from [here](https://github.com/ethereum/solidity/releases/tag/v0.4.17):
```
# Copy the source
wget https://github.com/ethereum/solidity/releases/download/v0.4.17/solidity_0.4.17.tar.gz

# Unpack the .tar.gz
tar xf solidity_0.4.17.tar.gz

# Install dependencies and build source
cd solidity_0.4.17/
./scripts/install_deps.sh

# The developers of solidity have set a gcc compilation flag that treats all warnings as errors, which makes compilation fail for this version.
# So you'll need to go into the makefile(s) and remove the `-Werror` flag to get compilation to succeed

# Open the .cmake file and comment out line 41: add_compile_options(-Werror)
> vim ./cmake/EthCompilerSettings.cmake #Comment out line 41

# Run the build script
./scripts/build.sh
```

### Install `evm` v1.6.6
Download `geth` 1.6.6 from the geth [downloads page](https://geth.ethereum.org/downloads/) using wget:
```
wget https://gethstore.blob.core.windows.net/builds/geth-alltools-linux-amd64-1.6.6-10a45cb5.tar.gz

tar xf geth-alltools-linux-amd64-1.6.6-10a45cb5.tar.gz

# Remove evm binary if one exists and copy 1.6.6 binary to /usr/bin
sudo rm /usr/bin/evm
sudo cp geth-alltools-linux-amd64-1.6.6-10a45cb5/evm /usr/bin/evm
```

### Install `Z3` v4.5.1
Download the source from the [downloads page](https://github.com/Z3Prover/z3/releases/tag/z3-4.5.0) using `wget`:
```
wget https://github.com/Z3Prover/z3/archive/z3-4.5.0.zip

cd z3-z3-4.5.0

python scripts/mk_make.py --python

cd build

make

sudo make install
```

### Install remaining dependencies for Oytente
To be compatible with `web3` later on, be sure to run:
```
sudo apt-get install python3-venv
python3 -m venv venv
pip install web3
sudo apt-get install python3.6-dev
```

Now, install `requests` and `web3`:
```
pip install requests
pip install web3
```

Finally, test the `oyente` command on a test file (e.g. create a test file `ex.evm` containing the text of the bytecode scraped for a contract from the previous step):
```
python oyente/oyente/oyente.py -s ex.evm -b
```

## Running Oyente Bytecode Analysis

To run Oyente on the bytecodes located in `ethereumetl/export/contracts_bytecode`and to export the results to a copy of `/contracts_bytecode` with fields containing the Oyente results appended, we wrote the `analyze-contract-code.js` script.

Note: because this script uses the now-experimental node v10.x worker_threads module, we must run this command with the `--experimental-worker` flag enabled.

```
Usage: node --experimental-worker analyze-contract-code.js [OPTIONS]

  Analyze bytecode with Oyente and write a copy of the contracts_bytecode
  data export with the additional Oyente results fields populated

Options:
-t, --threads INTEGER       The number of concurrent Oyente analyses to allow
                            to run concurrently (default 96)
-e, --export-path STRING    Location of the export directories
                            (default 'ethereumetl/export')
-o, --output-dir STRING     Location of the output directory
                            (default 'ethereumetl/export/contracts_analysis')
-b, --batch-size INTEGER    Batch size, i.e. the number of blocks' worth of 
                            data located in each CSV (default 100,000)
-m, --max-block INTEGER     The max block number (default 7532178)
-s, --start-block INTEGER   The number block to start scraping on (default 0)
-e, --end-block INTEGER     the number block to stop scraping on
                            (defaults to the value of MAX_BLOCK)
-l, --log-every INTEGER     Write to console on every n-th oyente completion
-d, --debug                 Turn on extra console logging
-h, --help                  Show usage and exit
```

To anaylze all bytecodes for all blocks with 96 concurrent threads and to store the result in `ethereumetl/export/contracts_analysis`, we can just run:
```
> node --experimental-worker analyze-contract-code.js 
```

Or, alternatively, to analyze the first 2,000,000 blocks' worth of contracts' bytecodes with Oyente with a maximum number of 32 concurrent Oyente threads, and to store the results in a new export directory in `ethereumetl/export` called `contracts_with_bytecode_and_oyente_data` (which contains identical data to `export/contracts` but with the bytecode and Oyente-analysis fields populated), we can run the command:
```
> OUT_PATH=ethereumetl/export/contracts_with_bytecode_and_oyente_data
> node --experimental-worker analyze-contract-code.js --start-block 0 --end-block 1999999 --threads 32 --output-dir $OUT_PATH
```

### Figuring out the Optimal Number of Worker-Threads in Worker-Thread-Pool
1 worker thread, blocks 0-99999:
```
  343 bytecodes, 35 errors
  402.364s batch total
  400.165s oyente time
  399.545s queue wait time
```

4 worker threads, blocks 0-99999:
```
  343 bytecodes, 54 errors
  186.62s batch total
  738.788s oyente time
  182.58s queue wait time
```

8 worker threads, blocks 0-99999:
```
  343 bytecodes, 36 errors
  162.612s batch total
  1280.029s oyente time
  156.304s queue wait time
```

16 worker threads, blocks 0-99999:
```
  343 bytecodes, 32 errors
  161.345s batch total
  2495.42s oyente time
  150.519s queue wait time
```

32 worker threads, blocks 0-99999:
```
  343 bytecodes, 34 errors
  155.541s batch total
  4639.814s oyente time
  129.623s queue wait time
```

64 worker threads, block 0-99999:
```
  343 bytecodes, 28 errors
  137.482s batch total
  6824.742s oyente time
  34.374s queue wait time
```

96 worker threads, block 0-99999:
```
  343 bytecodes, 27 errors
  136.414s batch total
  7966.224s oyente time
  0.677s queue wait time
```

128 worker threads, blocks 0-99999:
```
  343 bytecodes, 27 errors
  138.366s batch total
  7113.546s oyente time
  0.772s queue wait time
```

It looks like the total batch time continues to decrease until about 64 worker threads. Still, queue wait time does not tend towards zero until about 96 worker threads. This means that at 96 worker threads, there is never a time that one thread needs to wait to start executing its oyente analysis. Notice, though, that oyente time increases as thread number increases, since each individual oyente thread becomes slower the larger number of concurrent threads. All things considered, then, we will use 96 concurrent worker-threads.


### Changing Ec2 Instance Type

Clearly even with 96 concurrent Oyente threads, the t2.large does not have enough vCPUs and memory to process all the contract bytecode in a reasonable period of time. Given that there are about 2.4 million contracts, if we want to process all of them within 6-12 hours, we'll need to finish about 50-100 Oyente threads per second (right now we are finishing about 2.5/second).

To upgrade the instance type, you can just select "Actions"->"Instance State"->"Stop" on the AWS EC2 dashboard and then select "Actions"->"Instance Settings"->"Change Instance Type"

Note: this will change the public DNS name you use to ssh into the instance. And you will also need to restart the Python virtual environment to run Oyente and the node process that spawns Oyente threads.

Re-initialize and configure Python virtual env for Oyente:
```
pip install --upgrade pip setuptools
python -m virtualenv env
source env/bin/activate
python3 -m venv venv
. venv/bin/activate
pip install web3
nvm use 10.15.3
```

Alternatively, you can use the `ec2-analyzer-on-boot.sh` convenience script.

If you're a normal AWS user like me, Amazon won't let you create anything larger than a t2.2xlarge (8 vCPU's, 32GB memory). But we need more than that. One way around this is to select "Actions"->"Image"->"Create Image" for the t2.2xlarge version of the instance and then to create instances from that image (it may take tens of minutes or even longer to create the image).



