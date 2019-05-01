#!/bin/bash

pip install --upgrade pip setuptools

# Python virtuel env secret sauce to make Oyente work with web3
python -m virtualenv env
source env/bin/activate
python3 -m venv venv
. venv/bin/activate

pip install web3

# Set node version to 10.x
nvm use 10.15.3

# Pull the latest from git remote
git pull

# Sync up with S3
bash ./push-pull-s3.sh
