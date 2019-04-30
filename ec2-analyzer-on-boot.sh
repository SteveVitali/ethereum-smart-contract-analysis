#!/bin/bash

cd ethereum-smart-contract-analysis/

pip install --upgrade pip setuptools

python -m virtualenv env
source env/bin/activate

python3 -m venv venv
. venv/bin/activate

pip install web3

nvm use 10.15.3
