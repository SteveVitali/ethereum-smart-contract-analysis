# ethereum-smart-contract-analysis

### Setup Instructions

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

To check progress of each sub-directory:
```
(echo "blocks" && ls blocks &&
echo "transactions" && ls transactions &&
echo "token_transfers" && ls token_transfers &&
echo "receipts" && ls receipts &&
echo "transaction_hashes" && ls transaction_hashes &&
echo "logs" && ls logs &&
echo "contract_addresses" && ls contract_addresses &&
echo "token_addresses" && ls token_addresses &&
echo "contracts" && ls contracts)
```

Now, create a new database in [AWS Athena](https://console.aws.amazon.com/athena/home):
```
CREATE DATABASE ethereumetl;
```

Create tables for blocks, transactions, etc. by running the SQL located in `schemas/blocks.sql`, `schemas/contracts.sql`, et cetera.

Now we can try a sanity check, e.g.:
```
select count(*) from transactions; # ~7,500,000
```
