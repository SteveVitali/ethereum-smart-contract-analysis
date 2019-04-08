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

Clone Ethereum ETL and install dependencies

```
> git clone https://github.com/medvedev1088/ethereum-etl
> cd ethereum-etl
> sudo apt-get install python3-pip
>  pip3 install -e .
```

Run the export script

```
> START_BLOCK=0
> END_BLOCK=7481338
> nohup bash export_all.sh -s $START_BLOCK -e $END_BLOCK -b 100000 -p file://$HOME/.ethereum/geth.ipc -o output &
```

`/output` should contain these directories:

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

Make sure the [AWS CLI](https://aws.amazon.com/cli) is installed.

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

At this point, with the contents of `/output` synced to S3, Medvedev suggests converting Ethereum ETL files to Parquet for much faster querying. For now, we'll skip this step.

Now, create a new database in [AWS Athena](https://console.aws.amazon.com/athena/home):
```
CREATE DATABASE ethereumetl;
```

Create tables for blocks, transactions, etc. by running the SQL located in `schemas/blocks.sql`, `schemas/contracts.sql`, et cetera.

Now we can try a sanity check, e.g.:
```
select count(*) from transactions; # ~7,500,000
```
