#!/bin/bash

# Install geth (go-ethereum):
sudo apt-get install software-properties-common
sudo add-apt-repository -y ppa:ethereum/ethereum
sudo apt-get update
sudo apt-get install ethereum
geth account new

# Start geth and enable the RCP server on localhost:8545
nohup geth --cache=1024 --rpc --rpcport "8545" --rpcaddr "127.0.0.1" &

# Clone Ethereum ETL (my fork) and install dependencies
git clone https://github.com/SteveVitali/ethereum-etl.git
cd ethereum-etl

# Install python version satisfying >=3.5.3,<3.8.0
sudo add-apt-repository ppa:jonathonf/python-3.6
sudo apt-get update
sudo apt-get install python3.6
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.5 1
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.6 2

# Install python-dev for 3.6
sudo apt-get install python3.6-dev

# Install python packages
sudo apt-get install python3-pip
sudo -H pip3 install -e .

sudo pip3 install awscli
aws configure

echo "Installed and started geth, enabled python 3.6, installed pip packages"
echo "Ready to run export_all.sh script"
