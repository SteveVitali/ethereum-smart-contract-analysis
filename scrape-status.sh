#!/bin/bash

echo "blocks"
ls blocks

echo "transactions"
ls transactions

echo "token_transfers"
ls token_transfers

echo "transaction_hashes"
ls transaction_hashes

echo "receipts"
ls receipts

echo "logs"
ls logs

echo "contract_addresses"
ls contract_addresses

echo "token_addresses"
ls token_addresses

echo "contracts"
ls contracts

# Log file system data to monitor EBS disk space
df -h

echo "SCRAPING BLOCK RANGE: $START_BLOCK-$END_BLOCK"
